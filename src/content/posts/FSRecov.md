---
title: FSRecov
published: 2026-08-13
description: 'JYY OS 2026 M8'
image: ''
tags: [OS]
draft: true
lang: ''
---

## 理论

先讨论IO设备到底是如何与CPU交互的。

CPU和设备交互，本质上就是在读写设备的“寄存器”。

以键盘敲击字母为例子。

当敲下`A`的时候，键盘的某个数据寄存器可能就会有`A`的数据。

那CPU要如何知道键盘有新数据来了要处理呢？笨方法是`while`轮询，但显然太笨。IO设备一般会使用中断主动告诉CPU。

有点像syscall的意味，syscall是用户程序通知OS进入内核，中断是硬件通知CPU进入内核。

CPU会根据中断信号，和OS里的中断处理程序，跳到正确的地方执行逻辑。比如键盘的例子，CPU会跳到OS里键盘驱动程序相关的代码。

驱动里可能会结合`Capslock状态`之类的信息，把输入做些正确的转换。

:::tip
CPU怎么直接去读另一个设备的寄存器呢？
其实物理地址空间里不止有RAM，还有别的东西，MMIO(Memory-Mapped I/O)区域是设备寄存器，也占据物理地址空间的一部分。
``` txt
物理地址空间

0x00000000
│
│ RAM
│
├────────────
│ RAM
│
├────────────
│ PCIe MMIO
│
├────────────
│ GPU registers
│
├────────────
│ APIC registers
│
└────────────
0xffffffff...
```
:::

## 实验