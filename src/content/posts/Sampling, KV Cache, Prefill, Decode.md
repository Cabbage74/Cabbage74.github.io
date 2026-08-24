---
title: Sampling, KV Cache, Prefill, Decode
published: 2026-08-23
description: '对丐中丐GPT做一些改造'
image: ''
tags: [AI]
draft: false
lang: ''
---

## Sampling

上一节最后的朴素推理逻辑是每次都一定选最大概率的下一个Token。

``` python
def generate(idx, max_new_tokens):
    for _ in range(max_new_tokens):
        idx_cond = idx[:, -block_size:] # 逗号是Pytorch分维度写法，表示取所有行，最后block_size列
        logits, _ = forward(idx_cond) # [B, T, C]
        logits = logits[:, -1, :]
        probs = torch.softmax(logits, dim=-1)
        next_id = torch.argmax(  # 永远取最大
            probs,
            dim=-1,
            keepdim=True
        )
        idx = torch.cat((idx, next_id), dim=1) # Pytorch API, dim=1表示按列拼接
    return idx # [B, T+max_new_tokens]
```

这种策略叫`Greedy decoding`，实际上如果这么做的话连`softmax`都没有必要，因为`softmax`不会改变排名顺序。

`Sampling`就是让模型真的按概率生成下一个Token，增加回答多样性。

``` python
probs = torch.tensor([0.1, 0.2, 0.7])
next_id = torch.multinomial(probs, num_samples=1) # Pytorch API 返回 0、1、2 的概率分别约为 10%、20%、70%
```

`multinomial`这个函数自己实现也比较简单，把`[0, 1]`这个大线段按照权重切成若干小线段，然后生成一个随机数，这个随机数落在哪个小线段里，就说明选中这个线段对应概率的Token。

### Temperature

Temperature 调整概率分布的尖锐程度，就是一个除法操作。

``` python
scaled_logits = logits / temperature
```

温度小于1的时候，打分之间的数值差距被加大，送进`softmax`以后大数的优势就更大，越接近0就越接近`Greedy decoding`。

温度等于1就是原分布。

温度大于1让数值差距变小，送进`softmax`以后概率更随机。

### Top-K

Top-K表示只保留打分最高的K个，其余的置成`-inf`，这样送进`softmax`概率就接近零。

``` txt
原始 logits:  [5.0, 4.0, 2.0, 1.0, -1.0]
top_k = 2:    [5.0, 4.0, -inf, -inf, -inf]
```

主要是防止模型随机选到概率低得离谱的Token。

``` python title="加上Sampling以后的推理"
def sample_next_token(logits, temperature=1.0, top_k=None):
    if temperature < 0:
        raise ValueError("Temperature must be non-negative.")
    if temperature == 0:
        return torch.argmax(logits, dim=-1, keepdim=True)

    logits = logits / temperature

    if top_k is not None:
        if top_k <= 0:
            raise ValueError("top_k must be a positive integer.")
        k = min(top_k, logits.size(-1))
        top_k_values, _ = torch.topk(logits, k) # Pytorch API, 返回前k个最大值和索引 [B, k]
        min_top_k_value = top_k_values[:, -1].unsqueeze(-1) # Pytorch API, unsqueeze(-1)表示在最后一维增加一个维度 [B, 1]
        logits = logits.masked_fill(logits < min_top_k_value, float('-inf'))

    probs = torch.softmax(logits, dim=-1)
    next_token = torch.multinomial(probs, num_samples=1) # Pytorch API, 按照概率分布采样，返回采样的索引 [B, 1]
    return next_token

@torch.inference_mode() # 打上这个装饰器，推理的时候Pytorch就不会计算梯度了，节省计算资源
def generate(idx, max_new_tokens):
    for _ in range(max_new_tokens):
        idx_cond = idx[:, -block_size:] # 逗号是Pytorch分维度写法，表示取所有行，最后block_size列
        logits, _ = forward(idx_cond) # [B, T, C]
        logits = logits[:, -1, :]
        next_id = sample_next_token(
            logits,
            temperature=1.0,
            top_k=5
        )
        idx = torch.cat((idx, next_id), dim=1) # Pytorch API, dim=1表示按列拼接
    return idx # [B, T+max_new_tokens]
```

## KV Cache, Prefill, Decode

KV Cache是一个空间换时间的Trick，牺牲显存来减少计算量加速推理速度。

我认为KV Cache可以这样理解，推理过程中只关心下一个Token。与训练不同，历史Token的hidden representation都是不需要的，因为只根据当前最后一个Token的hidden representation来预测下一个Token。

再看每一次推理时，当前最后一个位置的Token到底需要什么信息：
- 自己的新 Q
- 自己的新 K/V
- 所有历史 Token 的旧 K/V

不需要历史Token的Q，因为这代表“过去的Token想查询什么信息”。

``` txt
w 的 Q
  去匹配
h、e、l、l、o、w 的 K
  然后读取
h、e、l、l、o、w 的 V
```

没有KVCache的时候，最后一个Token的hidden representation依赖历史Token的K和V，而某一层Block里历史Token的K和V依赖上一层里历史Token的最终hidden representation，这里有个递归依赖链。

只要缓存住每一层的K和V，推理的时候可以只让最后一个位置的Token向量进神经网络，`[T, C]`变成了`[1, C]`，对T个向量做Forward的计算量降成对1个向量做Forward。

``` txt
Token 的 QKV、MLP、LayerNorm：T 个 → 1 个
Attention scores：T×T → 1×T
```

KVCache初始化的过程就叫Prefill。对最初的Prompt里每个向量并行做一次Forward，预测出第一个字符，建立每一层的KV Cache。

后续只要每次拿当前最后一个Token进神经网络配合KV Cache预测出下一个Token，这个阶段就叫Decode。

``` python
class MultiHeadAttention:
    # ... 省略
    def forward(self, x, past_kv=None):
        # Prefill/训练时：x 是 [B, T, C]
        # 使用 KV Cache Decode 时：x 是 [B, 1, C]
        q = x @ self.Wq # [B, 1, C] @ [C, C] = [B, 1, C]
        k = x @ self.Wk
        v = x @ self.Wv

        B, T, C = x.shape
        q = q.reshape(B, T, n_head, head_size)
        k = k.reshape(B, T, n_head, head_size)
        v = v.reshape(B, T, n_head, head_size)
    
        q = q.transpose(1, 2) # 【B, n_head, T, head_size】
        k = k.transpose(1, 2)
        v = v.transpose(1, 2)

        past_length = 0
        if past_kv is not None:
            past_k, past_v = past_kv
            past_length = past_k.shape[2]
            k = torch.cat((past_k, k), dim=2) # [B, n_head, past_length + 1, head_size]
            v = torch.cat((past_v, v), dim=2)
    
        scores = q @ k.transpose(-2, -1)
        scores = scores / (head_size ** 0.5)
    
        # mask = torch.tril(torch.ones(T, T))
        if past_kv is None:
            mask = torch.tril(torch.ones(T, T, device=x.device)) # device=x.device确保mask和scores在同一个设备上
            scores = scores.masked_fill(mask == 0, float('-inf'))
        else:
            if T != 1:
                raise ValueError("When past_kv is provided, T must be 1.")
            # 不需要masking，因为每次只生成一个token，scores的shape是[B, n_head, 1, past_length + 1]，只需要计算当前token和之前所有token的注意力分数
    
        scores = scores - scores.max(dim=-1, keepdim=True).values
    
        exp_scores = torch.exp(scores)
    
        weights = exp_scores / exp_scores.sum(
            dim=-1,
            keepdim=True
        )
    
        out = weights @ v
    
        out = out.transpose(1, 2)
        out = out.reshape(B, T, C)
    
        out = out @ self.Wo
        present_kv = (k, v)
        return out, present_kv


def forward(idx, targets=None, past_kvs=None):
    past_length = 0
    if past_kvs is not None:
        if len(past_kvs) != n_layer:
            raise ValueError(f"Expected past_kvs to have length {n_layer}, but got {len(past_kvs)}.")
        past_length = past_kvs[0][0].shape[2]  # 每一层的KV Cache长度应该是一样的

    # Decode阶段T就是1
    B, T = idx.shape

    tok_emb = token_embedding_table[idx]
    # 变成只取最后一个位置
    positions = torch.arange(
        past_length,
        past_length + T,
        device=idx.device,
    )
    if past_length + T > block_size:
        raise ValueError(
            "KV Cache length exceeds block_size."
        )
    pos_emb = position_embedding_table[positions]

    x = tok_emb + pos_emb

    present_kvs = []
    for layer_idx, block in enumerate(blocks):
        layer_past_kv = None
        if past_kvs is not None:
            layer_past_kv = past_kvs[layer_idx]
        x, layer_present_kv = block.forward(x, past_kv=layer_past_kv)
        present_kvs.append(layer_present_kv)

    
    x = layer_norm(x, ln_f_gamma, ln_f_beta)

    logits = x @ W_lm + b_lm

    if targets is None:
        loss = None
    else:
        shifted_logits = logits - logits.max(dim=-1, keepdim=True).values
        exp_logits = torch.exp(shifted_logits)
        probs = exp_logits / exp_logits.sum(dim=-1, keepdim=True)

        correct_probs = []
        for b in range(B):
            for t in range(T):
                target_id = targets[b, t]
                correct_probs.append(probs[b, t, target_id])
        correct_probs = torch.stack(correct_probs)

        loss = -torch.log(correct_probs).mean()

    return logits, loss, present_kvs


@torch.inference_mode()
def generate_with_kv_cache(idx, max_new_tokens, temperature=1.0, top_k=None):
    # 由于位置编码是硬编码的，所以 KV Cache 的长度不能超过 block_size，否则位置编码会出错
    # 又由于我没写 KVCache 的 Eviction 策略，比如滑动窗口，所以 KVCache 是无脑增长的
    # 所以这里限制长度，否则 KV Cache 会随着生成超过 block_size
    if idx.shape[1] + max_new_tokens > block_size:
        raise ValueError("The total length of idx and max_new_tokens exceeds block_size.")

````if max_new_tokens < 0:
        raise ValueError("max_new_tokens must be non-negative.")

    if max_new_tokens == 0:
        return idx

    # Prefill阶段
    logits, _, past_kvs = forward(idx) # [B, T, C]
    next_id = sample_next_token(
        logits[:, -1, :],
        temperature=temperature,
        top_k=top_k
    ) # [B, 1]
    idx = torch.cat((idx, next_id), dim=1) # [B, T+1]

    # Decode阶段，每次只有一个Token向量进入神经网络
    for _ in range(max_new_tokens - 1):
        logits, _, past_kvs = forward(next_id, past_kvs=past_kvs) # [B, 1, C]
        next_id = sample_next_token(
            logits[:, -1, :],
            temperature=temperature,
            top_k=top_k
        )
        idx = torch.cat((idx, next_id), dim=1) # [B, T+2], [B, T+3], ...
    return idx # [B, T+max_new_tokens]
```

这是一个只追加、不淘汰的简单 KV Cache。Cache 长度随生成线性增长，直到达到这个丐版实现的 block_size，超过后直接报错。