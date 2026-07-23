---
title: Labyrinth
published: 2026-07-23
description: 'JYY OS 2026 M1'
image: ''
tags: [OS]
draft: false
lang: ''
---

## 有趣的理论知识

进程自身只看得到寄存器和内存里的内容，如果想获取其他自身的信息需要和OS交互。

一种是可以通过`getpid()`之类的的syscalls。

一种是`/proc`目录下的文件。

Unix通过`fork`和`execve`两个API来复制和复位状态机。

相对地，Windows提供`spawn`这个syscall。

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

相对地，Windows设计`spawn`这种API需要维护非常多参数来尽量满足创建不同种类进程需要的能力。