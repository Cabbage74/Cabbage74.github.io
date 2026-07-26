---
title: Labyrinth
published: 2026-07-23
description: 'JYY OS 2026 M1'
image: ''
tags: [OS]
draft: false
lang: ''
---

## 理论

进程自身只看得到寄存器和内存里的内容，如果想获取其他自身的信息需要和OS交互。

一种是可以通过`getpid`之类的的syscalls。

一种是`/proc`目录下的文件，`/proc`是一个伪文件系统，挂载在内存里不落盘。

Unix通过`fork`和`execve`两个API来复制和复位状态机。

``` c
pid_t pid = fork();
if (pid == 0) {
    // 子进程：我现在是父进程的完整克隆
    // 但我可以用自己的系统调用"重新配置自己"
    
    close(0);                    // 关掉继承的 stdin
    open("/dev/null", O_RDONLY); // 重定向到 /dev/null
    dup2(pipe_fd, 1);            // stdout 重定向到管道
    chdir("/some/dir");          // 切换工作目录
    setenv("PATH", "...", 1);   // 修改环境变量
    setgid(new_gid);            // 降权
    setuid(new_uid);            // 降权
    // ... 任何你能想到的状态修改
    
    execve("/bin/myprog", argv, envp);  // 最后才加载新程序
} else {
    ...
}
```

上面的代码创建了一个进程，在`execve`之前用代码自由的执行了降权之类的操作。

这体现了Unix的"机制而非策略"思想：内核提供 fork和 execve两个正交的机制，组合方式由用户态决定。

``` c
BOOL CreateProcess(
  LPCTSTR               lpApplicationName,
  LPTSTR                lpCommandLine,
  LPSECURITY_ATTRIBUTES lpProcessAttributes,
  LPSECURITY_ATTRIBUTES lpThreadAttributes,
  BOOL                  bInheritHandles,
  DWORD                 dwCreationFlags,
  LPVOID                lpEnvironment,
  LPCTSTR               lpCurrentDirectory,
  LPSTARTUPINFO         lpStartupInfo,
  LPPROCESS_INFORMATION lpProcessInformation
);
```

相对地，Windows设计`spawn`这类API需要维护非常多参数来尽量满足创建不同种类进程需要的能力。

教科书上一个简化的进程地址空间如下。

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

可以通过`brk`系统调用设置`break`的位置来控制堆区大小。历史上C语言里有一个`sbrk`函数是更高级的封装，现在被废弃了。

`mmap`操纵内存映射区。

想要看一个Linux进程具体的进程地址空间信息，可以用下面的命令。

``` bash
ubuntu@VM-0-9-ubuntu:~/os2026$ cat /proc/self/maps
5647336d4000-5647336d6000 r--p 00000000 fc:02 926                        /usr/bin/cat
5647336d6000-5647336da000 r-xp 00002000 fc:02 926                        /usr/bin/cat
5647336da000-5647336dc000 r--p 00006000 fc:02 926                        /usr/bin/cat
5647336dc000-5647336dd000 r--p 00007000 fc:02 926                        /usr/bin/cat
5647336dd000-5647336de000 rw-p 00008000 fc:02 926                        /usr/bin/cat
56476abe5000-56476ac06000 rw-p 00000000 00:00 0                          [heap]
7f76c0218000-7f76c023a000 rw-p 00000000 00:00 0 
7f76c023a000-7f76c0523000 r--p 00000000 fc:02 2694                       /usr/lib/locale/locale-archive
7f76c0523000-7f76c0526000 rw-p 00000000 00:00 0 
7f76c0526000-7f76c054e000 r--p 00000000 fc:02 11781                      /usr/lib/x86_64-linux-gnu/libc.so.6
7f76c054e000-7f76c06e3000 r-xp 00028000 fc:02 11781                      /usr/lib/x86_64-linux-gnu/libc.so.6
7f76c06e3000-7f76c073b000 r--p 001bd000 fc:02 11781                      /usr/lib/x86_64-linux-gnu/libc.so.6
7f76c073b000-7f76c073c000 ---p 00215000 fc:02 11781                      /usr/lib/x86_64-linux-gnu/libc.so.6
7f76c073c000-7f76c0740000 r--p 00215000 fc:02 11781                      /usr/lib/x86_64-linux-gnu/libc.so.6
7f76c0740000-7f76c0742000 rw-p 00219000 fc:02 11781                      /usr/lib/x86_64-linux-gnu/libc.so.6
7f76c0742000-7f76c074f000 rw-p 00000000 00:00 0 
7f76c0758000-7f76c075a000 rw-p 00000000 00:00 0 
7f76c075a000-7f76c075c000 r--p 00000000 fc:02 600                        /usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2
7f76c075c000-7f76c0786000 r-xp 00002000 fc:02 600                        /usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2
7f76c0786000-7f76c0791000 r--p 0002c000 fc:02 600                        /usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2
7f76c0792000-7f76c0794000 r--p 00037000 fc:02 600                        /usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2
7f76c0794000-7f76c0796000 rw-p 00039000 fc:02 600                        /usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2
7fffd6eb6000-7fffd6ed8000 rw-p 00000000 00:00 0                          [stack]
7fffd6f00000-7fffd6f04000 r--p 00000000 00:00 0                          [vvar]
7fffd6f04000-7fffd6f06000 r-xp 00000000 00:00 0                          [vdso]
ffffffffff600000-ffffffffff601000 --xp 00000000 00:00 0                  [vsyscall]
```

`/proc/self`是一个符号链接，指向"正在读它的那个进程"的PID目录。

所以上面的命令返回的是`cat`这个进程的地址空间映射信息。

## 实验

简单的模拟，热身实验。