---
title: 认识GPU（施工中）
published: 2026-08-24
description: '尝试从完全不懂到假装能懂...'
image: ''
tags: [AI]
draft: false
lang: ''
---

## 理解CPU如何指挥GPU工作

CPU就像一个全能博士，能**低延迟**地做复杂运算，但是数量少，多核CPU有几十个核就顶天了。

GPU内部有很多小学生，虽然只能做类似加减乘除这类简单的运算，但是人多力量大，**吞吐高**。

我的Python代码不会直接在GPU上执行，而是：

``` txt
Python 在 CPU 上运行
        ↓
PyTorch 看见输入 tensor 位于 CUDA
        ↓
PyTorch 调用已经编译好的 CUDA/C++ 实现
        ↓
CPU 向 GPU 提交一个 kernel
        ↓
GPU 从显存读取 tensor 并进行计算
        ↓
结果写回显存
```

`kernel`可以暂时理解成一个已经编译好、可以由大量 GPU 线程并行执行的函数。

显存是显卡上焊接上的内存芯片，供GPU读写，可以理解为GPU的专用高速内存。

就像CPU读主板上的内存条一样。

如果显存不够，就会OOM报错，或者GPU得通过PCIe去借用系统内存，性能就会跌。

``` python
x = torch.tensor([1, 2])
print(x.device) # cpu

x_gpu = x.to("cuda")
print(x_gpu.device) # cuda:0
```

Tensor默认不会在GPU里，可以显式地移动到GPU上，如果机器上插了两张卡，那就还可以指定到`cuda:1`去。

`.to()`这个API真的会把数据从系统内存经过PCIe拿去显存，所以是一个比较昂贵的操作。如果数据不在同一个设备，计算会报错。

``` python
x = torch.randn(
    1024,
    1024,
    device="cuda",
)
```

创建张量的时候可以指定`device`，会直接在显存中分配存储空间。

相比于在CPU创建然后移动省了一次传输。

``` python
c = a @ b
```

Pytorch的一个职责是设备判断与算子调度。它会看`a`和`b`两个Tensor位于哪个设备，如果在CPU就会调用CPU的实现，如果在GPU就会调用GPU的实现。

如果两个Tensor在GPU，这里执行的逻辑不是同步的：CPU通知GPU做然后停下 → GPU做完返回Success → CPU收到返回值再继续。

而是异步的：CPU通知GPU做 → 各做各的。

CPU执行这段Python代码，进到CUDA驱动，驱动里的逻辑是去写命令缓冲区（内存里一块区域），再写GPU的一个“门铃”寄存器（相当于两者的通信协议），GPU上有一个小的命令处理器看到“门铃”信号以后会去读命令缓冲区，然后执行。

这个命令缓冲区相当于一个工作队列，被称为`stream`。默认情况下，`stream`内的任务会保持顺序执行。

既然是异步的肯定有同步机制，`torch.cuda.synchronize()`会让CPU等到之前提交的任务全部完成。

这引出了几种计时的不同：

``` python title="测的是CPU把任务放进工作队列的时间"
start = time.perf_counter()
c = a @ b
end = time.perf_counter()
```

``` python title="CPU提交时间 + GPU执行时间 + CPU同步等待的额外开销"
torch.cuda.synchronize()
start = time.perf_counter()
c = a @ b
torch.cuda.synchronize()
end = time.perf_counter()
```

``` python title="GPU执行时间"
start_event = torch.cuda.Event(enable_timing=True) # CUDA Event 是插入 GPU 工作队列里的时间标记，比用 CPU 时钟测 GPU 工作更合适
end_event = torch.cuda.Event(enable_timing=True)
start_event.record()
c = a @ b
end_event.record()
```

## 显存容量、显存带宽、算力

显存容量：显存一共能放多少数据，比如RTX3090有24GB。

显存带宽：每秒能从显存搬多少数据，比如RTX3090的峰值是936GB/s。

GPU算力：每秒能做多少数学运算，比如RTX3090 FP32理论峰值约 35.6TFLOPS（35.6万亿次浮点数计算每秒）。

如果显存小了，会OOM。如果带宽小了，GPU计算单元就得等数据，有力使不出。

这引出两种瓶颈。

花在搬数据上的时间更多：

``` txt title="Memory-bound，受显存带宽限制"
读取 ███████████████
计算 ██
写回 █████
```

花在计算上的时间更多：

``` txt title="Compute-bound，受算力限制"
读取 ██
计算 ███████████████
写回 █
```

下面探讨应该如何分析一个任务会面临什么瓶颈。

考虑一个简单的加法：

``` python
y = x + 1
```

假设`x`是FP32，大小四字节。

那么这个过程涉及：

``` txt
读取 x：4 字节
执行加法：1 次浮点运算
写入 y：4 字节

合计：1FLOP，8字节
```

然后可以算一个值叫算术强度Arithmetic Intensity表示“每从显存搬一个字节，能做多少次运算”。

$\frac{1\text{ FLOP}}{8\text{ bytes}}=0.125\text{ FLOP/byte}$

0.125很低，说明大规模的逐元素加法会是一个Memory-bound的场景。

接下来考虑矩阵乘法：

``` python
C = A @ B # [4096, 4096] @ [4096, 4096] = [4096, 4096]
```

`C`中每个元素都来自向量点积，涉及4096次乘法和4095次加法，不妨约等于8192次FLOPS。

一共有$4096^2$这么多的元素，那就是 $2\times 4096^3$ 这么多的FLOPS，约1374亿。

所以矩阵乘法会是Compute-bound的场景，算术强度约大几百。

Roofline模型：$实际性能 \le min(GPU峰值算力，显存带宽\times 算术强度)$ 

能解释逐元素加法为什么喂不饱计算单元：$936\text{ GB/s}\times0.125\text{ FLOP/byte}\approx117\text{ GFLOPS}$

## 为什么Decode阶段Batch-Scaling能提升计算利用率

Transformer中存在很多Linear：

``` python
q = x @ Wq
k = x @ Wk
v = x @ Wv
h = x @ W1
```

在Decode阶段时，`x`的`shape`是`[B, 1, C]`，B是为了复用训练时用的Forward函数包装的一维，也是1。

``` python
y = x @ W
```

虽然看着是矩阵乘法，但左边其实是一条向量，本质接近“向量乘矩阵”，称作GEMV(General Matrix Vector)。

假设同时处理8个序列，`x`的`shape`变成`[B, 8, C]`，变成更正规的矩阵乘矩阵，称作GEMM(General Matrix-Matrix)。

:::tip
为什么Deocde阶段要同时处理8个序列？
看到了一篇论文SimpleTool，大概是一篇加速端侧小模型生成工具调用的文章。
其中一部分Idea就是不要用JSON Schema来生成工具调用，用论文自定义的格式。
比如：
``` txt
<fn>
<name>
<arg1>
<arg2>
...
</fn>
```
论文的一个想法是前文相同的情况下，模型应该能并行地预测工具名、第一个参数、第二个参数...只要函数API设计的好，每一个参数是正交的，应该就是可行的。
:::

8个序列共用一个模型，所以使用同一个`W`。

``` txt
x0 ─┐
x1 ─┤
x2 ─┤
... │ @ 同一个 W
x7 ─┘
```

每个输入都要与 W 相乘，但把它们合成一次大运算后，GPU 可以更好地复用权重数据，并使用更多并行计算单元。

用算术强度推导：

``` txt
x: [B, batch_size, C] // 这个batch_size指的是并行地推理，和训练时那个batch_size不是一个意思
W: [C, C]
```

那么计算量为$2batch\_size\times C^2$。

如果`W`是主要数据量，每个数是FP32，那至少要读取 $4C^2$ Bytes。

那么近似的算术强度是$\frac{2batch\_sizeC^2}{4C^2}=\frac{batch\_size}{2}\text{ FLOP/byte}$

这意味着同一份权重搬进来后，batch越大，计算利用率就越高。

这是RTX3090的Roofline模型的ridge point：

$\frac{35.6\text{ TFLOPS}}{936\text{ GB/s}}\approx38\text{ FLOP/byte}$

低于这个值，就是Memory-bound，反之就是Compute-bound。

Prefill阶段其实就像是一次batch_size比较大的Decode，这就解释了为什么它是Compute-bound的。

对应Decode阶段，batch_size是1，它是Memory-bound的。

## FP32、FP16、BF16 和 Tensor Core

## kernel、thread、warp、thread block 和 SM
