---
title: SPerf
published: 2026-07-28
description: 'JYY OS 2026 M3'
image: ''
tags: [OS]
draft: false
lang: ''
---

## 理论

ABI是规定已经编译好的程序如何交互的规范。

它包含但不限于以下方面：调用函数时参数放哪里？结构体内存布局如何Padding？函数名如何修饰？

类似CSAPP的书在教学的时候一般都是这样的心智模型：调用函数时，参数、局部变量、返回地址都扔到栈上。

这其实就是一种具体的ABI。

在x86的系统上其实是另一种规范，第一个参数会放到rdi上，第二个参数会放到rsi上...

``` c
int add(int a, int b);

int main()
{
    int x = add(10, 20);
}
```

假设`add`是我们写的一个汇编函数，为什么C语言能正确调用汇编呢？

因为Linux x86-64的ABI规定了第一个参数会放到rdi上，第二个参数会放到rsi上。

所以只要我们写的汇编函数确实是这样就能调用。这里的寄存器e开头指的是只拿低32位。

``` asm
add:
    mov eax, edi
    add eax, esi
    ret
```

也就是说如果需要裸写汇编，对于Linux和Windows两个平台就得维护两份代码，对应两种ABI。

但如果用C语法写`add`函数，编译器会根据ABI生成出正确的汇编。

C的ABI是事实上的通用接口，只要符合C的ABI就可以调用C函数，比如`libc`库里的函数。

## 实验

实现一个命令行工具，能启动另一个程序，然后统计这个程序里每个系统调用的时间。

`strace -T`其实有这个功能。JYY给的方法是父进程启动子进程跑`strace`，用管道拿到以后直接解析。

Linux还提供了`ptrace`这个系统调用，允许一个进程观察和控制另一个进程的执行。`strace, gdb, perf`这些都基于这个。

