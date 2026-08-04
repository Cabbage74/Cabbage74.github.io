---
title: PSTree
published: 2026-07-25
description: 'JYY OS 2026 M2'
image: ''
tags: [OS]
draft: false
lang: ''
---

## 理论

应用程序需要请求操作系统来做一件事情时，本质上都是要访问“操作系统中的某个对象”。

Unix的哲学是尽可能将这些对象以文件形式暴露出来，比如`/proc`目录。

文件描述符是这个“一切皆文件”哲学的基础。它的本质是一个可替换的I/O通道编号。

“一切皆文件”更准确的描述是Unix将大量资源抽象为可通过文件描述符访问的对象。

假设没有文件描述符，当程序通过`open`打开一个文件时，内核需要返回内核里文件的地址（或者其他类似的东西），但这既不安全，也破坏了抽象（程序不应该需要知道磁盘是怎么组织的）。

``` c
int fd = open("a.txt", O_RDONLY); // fd = 3
```

这个3是如何与实际文件关联起来的呢？

``` markdown
用户空间:
fd = 3

内核空间:
+----------------+
| fd table       |
+----------------+
|0 | stdin       |
|1 | stdout      |
|2 | stderr      |
|3 | a.txt       |
+----------------+
        |
        v
... 很多层
        |
        v
struct file
```

这个`fd table`在Linux内核里位于`task_struct`里的`files_struct`里面。每个进程都有`task_struct`。

由于文件描述符只是一个数字索引，可以很方便地统一所有资源。除了`file`，其他`socket`、`pipe`之类的东西也可以用`int`管理了。

每个Unix进程启动的时候`stdin, stdout, stderr`默认占三个文件描述符。

文件描述符是Unix管道的核心。

``` bash
ubuntu@VM-0-9-ubuntu:~$ ls | grep txt
a.txt
```

下面研究这条命令背后到底发生了什么。

在最开始，`shell`的`fd table`如下。

``` markdown title="shell fd table 1"
fd:
0 stdin
1 stdout
2 stderr
```

`shell`进程接收到这条命令以后，发现命令涉及管道，调用`pipe`这个syscall。

`pipe`这个syscall会创建一块内核缓冲区，并返回两个fd，一个读端一个写端。

此时`shell`的`fd table`如下。

``` markdown title="shell fd table 2"
fd:
0 stdin
1 stdout
2 stderr
3 pipe读端
4 pipe写端
```

现在正式调用`fork`召唤出`ls`。

`fork`会原样复制`fd table`。

``` markdown title="ls fd table 1"
fd:
0 stdin
1 stdout
2 stderr
3 pipe读端
4 pipe写端
```

此时`ls`实际上和`shell`没区别，在这个时候`execve`的话`ls`的输出还是会去`stdout`。

我们想让`ls`往`pipe`的写端里写，而不是往`stdout`里写。通过`dup2(4,1)`这个syscall把4号`fd`复制到1号。再`close(3), close(4)`把无关端口关掉。

``` markdown title="ls fd table 2"
fd:
0 stdin
1 pipe写端
2 stderr
```

此时再`execve`加载`ls`。`ls`的代码完全没有改动，但输出时`printf`里面的`write(1, ..)`这个系统调用无感知地往`pipe`的写端里写了。

`grep`同理，会经历类似上面的过程。

``` markdown title="grep fd table"
fd:
0 pipe读端
1 stdout
2 stderr
```

总的来说，管道的实现思想是修改程序看到的`fd`表。

`stty -a`可以看当前终端的绑定键。

``` bash
stty -a | claude '这几个快捷键都有什么用'
```

Unix也有类似Windows的任务管理。

``` txt
Ctrl-z 放后台
jobs 就像是Windows的任务管理器
fg/bg %n 把第n个job移到前台和后台
```

## 实验

扫描`/proc`里每一个数字进程的`status`，拿`ppid`。扫描`comm`拿名字。

建图，打印。

和Linux的实现的区别包括但不限于：Linux的实现还会打印出线程，是用花括号包裹的。同名的默认会被折叠成`n*[xxx]`的形式。