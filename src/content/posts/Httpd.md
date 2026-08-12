---
title: Httpd
published: 2026-08-12
description: 'JYY OS 2026 M7'
image: ''
tags: [OS]
draft: false
lang: ''
---

## 理论

线程虽然能并发，但线程的创建与切换本身也有代价（8MB的栈，上下文切换），创建线程的代价有可能比函数调用还要大。

问题是：线程虽然比进程轻，但还是太重，怎么更轻，还能支持大量并发任务？

对于这种情况，一种思路是设计出更轻量的线程，一种思路是事件驱动异步编程模型。

先看第一种思路。

``` python
import random

THREADS = 1_000_000


def T_worker(name):
    i = 0
    while (i := i + 1):
        yield f"[{name}] i = {i}"


threads = [T_worker(i) for i in range(THREADS)]

count = 0

while count < 10_000_000:
    current = random.choice(threads)
    res = current.send(None) # 等价于 res = next(current)
    print(res)
    count += 1
```

Python的`yield`语法就像是一个生产用户态的简易协作式线程的工具（含有`yield`的函数是一个`generator`），当`generator`运行到`yield`时就暂存当前函数的上下文，然后主动让出时间片，这里的`random`就像是一个调度器。

但这本质是在用户态模拟“并发”，由第三方线程库的调度逻辑或者编程语言自己的运行时来调度，内核是感知不到这些用户线程的，所以没有物理并行，内核眼里还是只有一个Python线程在跑，对于CPU密集的任务作用不大。

但对于I/O密集的任务，这种用户态线程配合非阻塞的I/O API是很有作用的。

``` txt
task A： 
CPU 1ms 
read syscall
CPU 1ms

taskB:
...
```

假设有这样一个A任务，如果用默认的阻塞式`read`，没有东西读就等着，那用户线程跑到这里的时候已经陷入内核开始等待，也无法`yield`以后让实际的内核线程去跑B任务。

但`read`其实可以开启`O_NONBLOCK`非阻塞模式（OS提供了），没读到会立即返回一个特殊值`EAGAIN`。那代码逻辑里其实就可以写好出现这种情况就`yield`，先让B任务跑起来。

:::tip
那么对于非阻塞的API，到底什么时候才该回来读呢？
如果只是过一会就回来读，重复`read → EAGAIN → yield`的这个过程，那就还是轮询，并且这里的“一会”是多久也很难确定。
如果能把I/O对象设计成fd，就可以用epoll来监听了！
所以流程应该是`read → EAGAIN → 注册fd到epoll → yield → 调度器去跑任务B ... 某一刻fd变成ready → epoll_wait()返回这个fd → 调度器去唤醒任务A`
:::

这种需要自己写调度器，控制用户线程间如何`yield`的模型对程序员的心智负担还是有点大的。

如果能让程序员仍然按照传统同步阻塞的线程模型写代码，而由语言运行时负责轻量线程的创建、调度、阻塞与唤醒，就可以进一步降低并发编程的负担。Go 的 goroutine 基本就是这条路线。

``` go
func worker() {
    data := readSomething()
    result := process(data)
}

go worker()
```

Go就是这样的语言，这看起来完全是同步阻塞代码，但Go的运行时不会让这个goroutine在`read`处阻塞，而是让它睡去，等有消息了再唤醒，背后和`epoll`那套是一样的。

并且Go的运行时会维护若干内核线程与若干goroutine之间的映射，实现物理上的并行。

Go隐藏了用户线程调度的细节，隐藏了异步I/O的实现机制，但程序员还是需要处理很多并行流，此时就需要用上互斥与同步。

再看第二种事件驱动的异步编程模型思路。

JavaScript是这种思路的实践者，因为JavaScript服务于网页，而网页会面临很多事件，比如鼠标不知道什么时候会被点击，网页请求不知道什么时候会结束。

浏览器需要协调用户输入、脚本执行、网络、定时器和渲染等大量不同时到来的事件，因此使用 event loop 组织这些任务。

``` js
read(fd, callback);
```

在JavaScript里，一般都使用非阻塞的I/O API。

这样的一个`read`实际上的行为如下。

```
1. 我要读 fd
2. 现在数据还没准备好
3. js runtime 记住：
       fd 123 ready 之后
       要执行 callback
4. 当前 JS 函数返回
5. JS 继续做别的事情
```

在单线程event loop中，一个同步callback一旦开始执行，会run-to-completion，其他callback不会从中间插入，因此普通callback之间通常不需要mutex来防止线程抢占。

:::tip
什么是event loop？
event loop 不是 JS 语法的一部分，而是浏览器/Node 这样的 runtime 提供的调度机制。
可以粗略理解为：
``` txt
while (true) {
    从队列拿一个事件
    执行它对应的 JS callback
    callback 执行完
    再拿下一个
}
```
传统 JavaScript 的主执行模型是单线程的。大概是这样的模型：
``` txt
              event queue
       ┌────────────────────┐
       │ callback A         │
       │ callback B         │
       │ callback C         │
       └──────────┬─────────┘
                  ↓
             event loop
                  ↓
          一个 JS 执行线程
                  ↓
                CPU
```
:::

``` js
readFile("a.txt", function (err, data) {
    if (err) {
        console.error(err);
        return;
    }

    console.log(data);

    // 读完以后要做的后续事情
    process(data);
});

console.log("我不用等 read 完成");
```

本质上回调函数里就是`read`结束以后应该继续做什么。

所以其实原始的事件驱动的心智模型很简单，由语言的运行时去决定什么时候回来执行这段I/O之后的逻辑。

``` js
readA(function (a) {
    readB(a, function (b) {
        readC(b, function (c) {
            process(c);
        });
    });
});
```

但这样的写法会容易造成回调地狱，写出不好阅读的代码。

“未来的结果”和“结果出来以后做什么”现在全部通过函数嵌套表达，控制流越来越难读。

Promise/Future其实是把“未来的结果”抽象成对象。

``` js
readA(function(a) {
    process(a);
});
```

变成

``` js
const p = readA();
```

`p`并不是`a`，而是一个未来可能会产生结果的对象，目前是`pending`，未来可能变成`fulfilled(a)`或`rejected(error)`。

``` js
readA()
    .then(function(a) {
        return readB(a);
    })
    .then(function(b) {
        return readC(b);
    })
    .then(function(c) {
        process(c);
    });
```

代码变成这样。

但程序员还是想像写同步程序一样写异步程序。

``` js
const a = readA();
const b = readB(a);
const c = readC(b);
process(c);
```

类似这种东西。

于是就有了async/await语法糖：

``` js
async function work() {
    const a = await readA();
    const b = await readB(a);
    const c = await readC(b);

    process(c);
}
```

看起来像同步代码，但实际上语义是：

``` txt
启动 readA
↓
结果没好
↓
暂停当前 async function
↓
把控制权还给 event loop
↓
event loop 跑其他任务
↓
Promise 完成
↓
恢复这个 async function（从上次暂停那一行开始）
```

Python的async/await也是类似的东西。

``` python
import asyncio

async def worker():
    print("A")

    data = await read_something()

    print("B")
    process(data)
```

执行流大概如下。

``` txt
worker 运行
↓
print("A")
↓
await read_something()
↓
结果还没好
↓
暂停 worker coroutine
↓
控制权回到 event loop
↓
event loop 去运行别的 coroutine
↓
read 完成
↓
event loop 再恢复 worker
↓
data = 结果
↓
print("B")
```

和JavaScript的区别是Python里这个event loop由asyncio这个库提供，而不是语言运行时提供。

``` txt
while True:
    找一个 ready 的 coroutine
    恢复它运行

    它：
        return
        或者 await

    回到 event loop
```

这个event loop大概可以这么理解。

``` python
import asyncio


async def worker(name):
    print(name, "start")

    await asyncio.sleep(1)

    print(name, "end")


async def main():
    await asyncio.gather( # 一下子丢多个coroutine给event loop
        worker("A"),
        worker("B"),
        worker("C"),
    )
    # await worker("A")
    # await worker("B")
    # await worker("C")
    # 这样就是3秒


asyncio.run(main())
```

这个例子程序的输出是`A start B start C start 1秒 A end B end C end`。

``` txt
async def
    → 定义 coroutine

await X
    → 当前 coroutine 等 X，期间可以让 event loop 跑别人

create_task(X)
    → 把 coroutine X 注册成可以独立调度的 Task

gather(A, B, C)
    → 一起调度 A/B/C，并等待它们全部结束

asyncio.run(main())
    → 创建/运行 event loop，从 main 开始跑
```

Python asyncio的几个语义。

## 实验