---
title: MyMalloc
published: 2026-08-06
description: 'JYY OS 2026 M5'
image: ''
tags: [OS]
draft: true
lang: ''
---

## 理论

为了让程序在进行一些耗时的操作，比如等待用户输入，等待磁头转到磁盘某个位置时能不让CPU干等着，我们希望计算机能并发地执行任务。

``` text
┌─────────┐ 高地址
│  stack  │
├─────────┤
│    ↓    │
│   mmap  │
│    ↑    │
├─────────┤ ← break
│  heap   │
├─────────┤
│  bss    │
│  data   │
│  text   │
└─────────┘ 低地址
```

多进程可以做并发任务，但假设两个进程需要汇总结果，那么可能需要`pipe`或者`mmap`这样之前见过的机制。

IPC（进程间通信）是麻烦的。如果操作系统能提供天然的共享内存的“进程”就好了。

```
┌─────────────────┐ 高地址
│  Thread 1 stack │
├─────────────────┤
│  Thread 2 stack │
├─────────────────┤
│  Thread 3 stack │
├─────────────────┤
│                 │
│      mmap       │
│                 │
├─────────────────┤
│      heap       │  ← 共享
├─────────────────┤
│      bss        │  ← 共享
├─────────────────┤
│      data       │  ← 共享
├─────────────────┤
│      text       │  ← 共享
└─────────────────┘ 低地址
```

线程就是这样的概念，有独立的栈和寄存器（CPU寄存器的快照方便进行线程切换）。

新增一个线程就是新增一个状态机，状态迁移由执行一条指令变成选择一个状态机然后执行一条指令。

线程的引入带来了不确定性，每次选哪个线程执行是不确定的，每个线程的执行速度也不一样。

``` c
#include <stdio.h>
#include <pthread.h>

#define N 100000000

long sum = 0;

void *T_sum(void *arg)
{
    for (int i = 0; i < N; i++) {
        sum++;
    }

    return NULL;
}

int main()
{
    pthread_t t1, t2;

    pthread_create(&t1, NULL, T_sum, NULL);
    pthread_create(&t2, NULL, T_sum, NULL);

    pthread_join(t1, NULL);
    pthread_join(t2, NULL);

    printf("sum = %ld\n", sum);

    return 0;
}
```

这是一个经典的例子，两个线程同时加全局变量`sum`，由于`sum++`包含的`load`与`store`汇编并不原子，会导致一些操作丢失。

``` bash
ubuntu@VM-0-9-ubuntu:~$ ./thread_sum
sum = 102233151
```

这是经典的不确定性。

但并发带来的不确定性不止于此，它会和计算机系统里其他不确定的地方交织起来。

``` bash
ubuntu@VM-0-9-ubuntu:~$ gcc thread_sum.c -o thread_sum_O1 -pthread -O1
./thread_sum_O1
sum = 100000000
ubuntu@VM-0-9-ubuntu:~$ gcc thread_sum.c -o thread_sum_O2 -pthread -O2
./thread_sum_O2
sum = 200000000
```

编译器根据C语言内存模型优化，而C语言规定：对普通非原子变量产生数据竞争的程序是UB。

也就是说它没有义务考虑另一个线程，所以优化可能很激进。

下面的优化针对于实验用的机器，不同机器不同编译器的优化可能不同。

`-O0`时，循环里面是`load-add-store`。

开启`-O1`时，编译器会把`load`和`store`提到循环外面，循环里只做`add`。因为两个线程都只在开头读，结尾写，很容易开头读到零，然后加完以后写成一亿。

开启`-O2`时，编译器直接常量折叠，把循环优化成一条`add`，相当于`sum += N`。

`-O2`这种歪打正着的“正确行为”可能在并发程序调试时带来更大的困难。

除了编译器，现代CPU的复杂行为也会影响并发编程。

``` c
#include <stdatomic.h>

atomic_int x = 0;
atomic_int y = 0;

int t1, t2;

void *T_1(void *arg)
{
    atomic_store_explicit(&x, 1, memory_order_relaxed);
    t1 = atomic_load_explicit(&y, memory_order_relaxed);
    return NULL;
}

void *T_2(void *arg)
{
    atomic_store_explicit(&y, 1, memory_order_relaxed);
    t2 = atomic_load_explicit(&x, memory_order_relaxed);
    return NULL;
}
```

先不管`memory_order_relaxed`是什么，两个线程针对原子变量`x y`做读与写，代码里都是原子操作。

对于这样的代码，如果认为CPU严格按照源码顺序，而且写入立即被另一个CPU看见，至少有一个线程应该看到另一个线程的写入，也就是说`t1 t2`的输出不可能是`0 0`。

但确实很可能输出`0 0`。

这是因为现代CPU为了速度（性能就是金钱），并不会每次`store`都立马写回内存（指所有CPU都能看到的内存，甚至可能不是RAM）再进行下一条指令。

``` txt
                    RAM / Cache Coherence
                         x=0 y=0
                         ↑      ↑
                         |      |
                  ┌──────┘      └──────┐
                  │                    │
              CPU 0                  CPU 1
          ┌────────────┐          ┌────────────┐
          │Store Buffer│          │Store Buffer│
          └────────────┘          └────────────┘
              T1                     T2
```

CPU可以写进自己的`store buffer`就继续下一条指令，所以另一个CPU可能看不到。

这里只保证所有CPU最后能看到一样的（最终一致性），但什么时候才能并没有保证。

C/C++11的内存模型针对现代CPU的这些复杂现象，定义了一些语义，程序员应该基于这些语义去推理，写出好的并发程序。

比如`memory_order`，C/C++语言规定“无论CPU内部怎么实现，最终允许程序观察到哪些结果”。

把`memory_order_relaxed`换成`memory_order_seq_cst`，能解决`0 0`的问题。具体有哪些内存序，以及它们的工作原理，这里先不展开。









## 实验