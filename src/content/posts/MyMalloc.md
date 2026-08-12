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

线程就是这样的概念，只有独立的栈（但还是在一个地址空间，意味着另一个线程只要真的有地址，还是能访问的）和寄存器（CPU寄存器的快照以方便进行线程切换）。

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

开启`-O2`时，编译器直接把循环优化成一条`add`，相当于`sum += N`。

`-O2`这种歪打正着的看似“正确行为”可能在并发程序调试时带来更大的困难。

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

这是因为现代CPU为了速度（性能就是金钱），并不会每次`store`都立马写回内存（在简化的心智模型里CPU都是写进内存，比如冯诺依曼架构，内存对所有CPU可见）再进行下一条指令。

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

CPU可以写进自己的`store buffer`就继续下一条指令，所以另一个CPU可能无法立即看到。

C/C++11的内存模型针对现代CPU的这些复杂现象，定义了一些语义，程序员应该基于这些语义去推理，写出好的并发程序。

或者说C/C++11给一个抽象的并发语义契约；编译器负责在各种具有`store buffer`、乱序执行等机制的 CPU 上实现这个契约。

比如`memory_order`，是C/C++语言用来规定原子操作的同步强度。

`memory_order_relaxed`就是不做什么干预，允许CPU以这种宽松的内存序处理程序。

把`memory_order_relaxed`换成`memory_order_seq_cst`，就能解决`0 0`的问题。

下面是GPT SOL概括的四个内存序。

``` txt
relaxed   ：只保证这个原子变量本身不会读写撕裂，不帮你建立顺序
release   ：我之前做的事情，不能跑到这个 release 后面
acquire   ：我之后做的事情，不能跑到这个 acquire 前面
seq_cst   ：acquire + release + 所有 seq_cst 操作还有一个全局统一顺序
```

并发编程很困难，应对的方法就是退回到“不并发”。

``` c
lock()
...
unlock()
```

互斥能让一片区域只有一个线程处理。

下面讨论互斥锁的实现。

先讨论最小问题：我在自己的用户态程序里，怎么凭空做出一把“同时只能一个线程进去”的锁？

``` c
locked = 0

void lock() {
    while (locked == 1)
        ;

    locked = 1;
}

void unlock() {
    locked = 0;
}
```

由于`load store`是两个动作，这里存在`data race`。

硬件提供一些原子操作，比如`atomic exchange`。

:::tip
对于远古时代没有原子操作的硬件呢？
一些经典算法，比如Peterson算法，但基于足够强的内存序，以及`load store`本身的原子。
更远古只有单核的机器只要关中断就只有一个执行流能运行，也相当于互斥了。
:::

``` c
int exchange(int *p, int new) {
    // 原子地：
    old = *p;
    *p = new;
    return old;
}

void lock() {
    while (exchange(&locked, 1) == 1)
        ;
}
```

利用这些原子API能简单地实现互斥锁。

下面是一个真的C11程序。

``` c
#include <stdio.h>
#include <pthread.h>
#include <stdatomic.h>

#define N 1000000

atomic_int locked = 0;
long sum = 0;

void my_lock() {
    while (atomic_exchange_explicit(
        &locked,
        1,
        memory_order_acquire)) {
    }
}

void my_unlock() {
    atomic_store_explicit(
        &locked,
        0,
        memory_order_release);
}

void *worker(void *arg) {
    for (int i = 0; i < N; i++) {
        my_lock();
        sum++;
        my_unlock();
    }

    return NULL;
}

int main() {
    pthread_t t1, t2;

    pthread_create(&t1, NULL, worker, NULL);
    pthread_create(&t2, NULL, worker, NULL);

    pthread_join(t1, NULL);
    pthread_join(t2, NULL);

    printf("sum = %ld\n", sum);
    printf("expected = %d\n", 2 * N);
}
```

为什么这里需要`acquire`与`release`呢？

``` c
my_lock();

x = 666;

my_unlock();
```

因为需要保证`x = 666`一定不被`lock`之前看到，一定被`unlock`之后看到。

如果`unlock`了，锁中间这个线程做的修改还在`store buffer`里不对所有CPU可见那就不符合我们想要的了。

总结一下目前为止的，实现一把互斥锁：原子操作 + `acquire/release`。

但这样的自旋锁浪费时间片，等待的线程拿到时间片以后什么都干不了。

理想情况是没抢到就睡觉去，回家等通知。但让线程睡觉这件事是用户态自己做不到的。

``` txt
Thread A
lock
进入临界区


Thread B
lock
发现失败
    ↓
告诉 OS：
“我暂时不用 CPU 了”
    ↓
sleep 
```

由OS的调度器把B从Runnable队列移走，等A解锁了再唤醒B。

这就是`mutex`和`spinlock`的区别。

``` txt
pthread_mutex_lock()   由 glibc 的 pthread 库在用户态实现
        │
        ▼
先在用户态用原子指令 CAS 抢锁
        │
   ┌────┴────┐
   │         │
 成功       失败
   │         │
直接返回   竞争严重
             │
             ▼
        futex syscall
             │
             ▼
         Linux 内核
        把线程睡眠
```

## 实验

像CSAPP那个Malloc Lab的略微简化版，实现并发安全的`malloc`和`free`。

不用考虑碎片合并，大锁在函数入口上锁，`return`前出锁就能过所有测试。