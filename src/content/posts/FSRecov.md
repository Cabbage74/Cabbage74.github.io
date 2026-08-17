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

文件系统本质是将块设备按照某种方法（如ext4）维护成数据结构（目录树）。

`mount`这个syscall可以把一个块设备挂载（解析块设备）到指定目录。比如插U盘这个例子，桌面上或者某个文件夹里会多一个U盘文件夹。

目录树这个数据结构在Linux表现为每个节点是`inode`。

把文件名想象成边，硬链接`ln a.txt b.txt`表现为从目录节点新建一条边指向`a.txt`那条边指向的节点。所以`rm`这个操作本质调的syscall是`unlink`，引用计数减一，不管是`rm a.txt`或是`rm b.txt`都不会删这个节点。

软链接/符号链接`ln -s a.txt b.txt`表现为从目录节点新建一条边指向一个新节点，这个新节点可以看作什么都没有就是个路径字符串`a.txt`。内核解析时看到了会跳到目标路径的文件。

文件有很多属性。

``` txt title="ls -l截取一行出来作拆解"
-rw-rw-r--   1   ubuntu   ubuntu   44   Aug 5 19:09   add.c
│            │     │        │      │        │          │
│            │     │        │      │        │          └─ 文件名
│            │     │        │      │        └─ 最后修改时间 mtime
│            │     │        │      └─ 文件大小，单位字节
│            │     │        └─ 所属组 group
│            │     └─ 所有者 owner
│            └─ 硬链接数量
└─ 文件类型 + 权限

-   rw-   rw-   r--
│    │     │     │
│    │     │     └─ others：其他用户
│    │     └─ group：同组用户
│    └─ user：文件所有者
└─ 文件类型

-    普通文件
d    directory，目录
l    symbolic link，符号链接
c    character device，字符设备
b    block device，块设备
p    pipe/FIFO
s    socket
```

除了这些自带的，文件可以通过`xattr`添加任何想要的属性。比如`embedding`（VectorFS）。

文件系统还提供了很多强力的功能。

如果有监控文件改变的需求（比如写Web的时候热更新，Vscode监控文件变化），Linux提供`inotify`这组syscall。通过注册文件描述符，关心的事件（比如修改），就能和`epoll`这种机制联动了。

`inotify`本质是内核提供给了我们一套hook机制，修改`inode`的时候发现正好有人watch它时就通知。

`eBPF`是一个更强的机制，正好也能做这件事。`eBPF`是一个Linux提供的机制，允许把用户态代码注入到内核提供的特定hook里（当然Linux会检查必须是安全的代码）。那其实可以自己实现更丰富的监控逻辑。

`eBPF`还能做很多事。`BPF(Berkeley Packet Filter)`原本是一种针对网络包的技术，如果想过滤一些网络包，比如来自某个IP的网络包，那过滤的逻辑得写在用户态代码里，然后才能丢掉。但是如果过滤代码能在内核运行可以快很多，省去很多上下文切换和数据拷贝。这个技术从只针对网络包到针对所有，变成了`extended BPF`。

除了监控还有个`overlay`的机制很有趣。

`mount`除了挂载，可以把两个目录拼凑成一个虚拟的目录。

``` txt title="比如两个目录是upper和lower"
          upper/
             +
          lower/
             │
             ▼
         merged/
```

这个目录满足：所有的写入都写进upper（如果是删除lower里有的，在upper打tombstone，如果是修改，从lower里拷贝一份到upper再修改），对于重名文件优先看到upper里的。

这个功能能让我们实现“网吧管理”这种功能，给每个顾客一个upper就行了，下一个顾客来就换一个upper。

Docker大量用了这个。

``` dockerfile
FROM ubuntu
RUN apt install python3
COPY app /app
```

一开始，lower是ubuntu镜像，然后在upper里装python环境。然后把这当成一个整体lower，在upper里拷贝宿主机的目录。

``` txt
┌────────────────────────┐
│ container writable     │ ← upper
├────────────────────────┤
│ app layer              │ ← 这里以及下面都是镜像层（lower）
├────────────────────────┤
│ python layer           │
├────────────────────────┤
│ ubuntu base            │
└────────────────────────┘
```

最后再加一层容器可写层，一个Docker容器就可以跑了。

如果在容器里`echo hello >> /app/main.py`并不会写镜像层的`main.py`，而是把这个文件拷贝一份到可写层。所以容器的写入不会影响镜像层，而同一个镜像的多个容器能共享这个镜像，节省空间。

![Image](./images/GPTSOL.png)

当我问GPT SOL这个机制背后的原理时...

## 实验

实验目标是写一个命令行工具`fsrecov`尽可能多地从被快速格式化的FAT32镜像里恢复出BMP图像。

FAT32文件系统的格式化不会真的把块设备里的数据全部清空，而是会清空FAT32里的一个File Allocation Table。相当于只是擦掉了定位真实数据的指针的信息。

既然数据区没被破坏，只是元数据区被破坏了，那就有一定的办法恢复出一些文件。

比如实验给的文件都是BMP文件，根据这些文件的特征可以硬编码一些规则。



