---
title: GPT.c
published: 2026-08-10
description: 'JYY OS 2026 M6'
image: ''
tags: [OS]
draft: false
lang: ''
---

## 理论

互斥只解决了“谁做无所谓，但不能同时做”。

但有些并发问题对谁来做的先后顺序有要求，比如生产者-消费者问题。

``` c
while (1) {
    lock(&mutex);

    if (!queue_empty()) {
        item = pop();
        unlock(&mutex);
        break;
    }

    unlock(&mutex);
}
```

当然消费者也可以写成这个样子，不停地去看队列里有没有消息。但这又显然在`busy waiting`浪费资源。

于是可以发明条件变量，条件不满足的时候就去睡觉，条件满足了再被唤醒（类似优化自旋锁的思路）。

``` c title="消费者"
pthread_mutex_lock(&mutex);

while (queue_empty()) {
    pthread_cond_wait(&cond, &mutex); // 释放mutex，然后睡觉
}

item = pop();

pthread_mutex_unlock(&mutex);
```

``` c title="生产者"
pthread_mutex_lock(&mutex);

push(item);

pthread_mutex_unlock(&mutex);

pthread_cond_signal(&cond);
```

条件变量的模版：

``` c
等待条件满足： lock(lk); while(!cond) wait(cv, lk); unlock(lk);
条件可能满足： broadcast(cv); signal(cv); // 唤醒所有or唤醒一个
```

除了条件变量，信号量也可以用来同步，信号量就像是带一个计数器的互斥锁。

信号量和互斥锁的区别是信号量没有`owner`，互斥锁原则上要由同一个线程来上锁解锁，不然就是UB。

信号量看上去比条件变量好用很多，但是对于复杂条件，比如一些带有“或”的条件，用信号量实现理解起来就没有那么显然，但是用条件变量的话还是直接套模版放在`cond`那个位置就行了。

## 实验

给了现成的`gpt.c`是一个神经网络推理的实现。但是实现是串行的，找到能并行化的部分，改造成并行推理。

神经网络层内都能并行，是一个`spawn join`的简单运用，连锁都不需要。