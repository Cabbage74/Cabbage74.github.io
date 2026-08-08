---
title: C-REPL
published: 2026-08-04
description: 'JYY OS 2026 M4'
image: ''
tags: [OS]
draft: false
lang: ''
---

## 理论

可执行文件到底是什么？

``` text
┌─────────┐ 高地址
│  stack  │ <- OS
├─────────┤
│    ↓    │ 
│   mmap  │ <- OS
│    ↑    │
├─────────┤ 
│  heap   │ <- OS
├─────────┤
│  bss    │
│  data   │ <- ELF
│  text   │
└─────────┘ 低地址
```

这样一个简化的进程地址空间不是全在ELF里的。

ELF只描述程序初始需要加载哪些东西。如代码段、全局变量。

而OS负责把它变成一个运行中的进程。

比如栈是由OS创建的，然后OS把`argc, argv, envp`放在初始的栈上。ELF的入口执行点是`_start`的地址，CRT相关的代码负责从这个初始栈里取出参数，喂给真正的`main`。

ELF(Executable and Linkable Format)不等价于可执行文件，实际上在Linux里有三种。

`.o`可重定位文件，可执行文件，`.so`共享目标文件。

``` c title="main.c"
#include <stdio.h>

int add(int a, int b);

int main() {
    int result = add(10, 20);

    printf("result = %d\n", result);

    return 0;
}
```

``` c title="add.c"
int add(int a, int b) {
    return a + b;
}
```

如果`gcc main.c`或者`gcc add.c`都是不会通过的，一个报找不到`add`，一个报找不到`main`(`_start`函数里调了`main`)。

我们需要把两份代码给链接到一起。链接器会通过符号解析、重定位两步做这件事。

通过`gcc -c xxx`得到`.o`的可重定位文件。

``` bash
ubuntu@VM-0-9-ubuntu:~/elf-lab$ readelf -s main.o

Symbol table '.symtab' contains 7 entries:
   Num:    Value          Size Type    Bind   Vis      Ndx Name
     0: 0000000000000000     0 NOTYPE  LOCAL  DEFAULT  UND
     1: 0000000000000000     0 FILE    LOCAL  DEFAULT  ABS main.c
     2: 0000000000000000     0 SECTION LOCAL  DEFAULT    1 .text
     3: 0000000000000000     0 SECTION LOCAL  DEFAULT    5 .rodata
     4: 0000000000000000    62 FUNC    GLOBAL DEFAULT    1 main
     5: 0000000000000000     0 NOTYPE  GLOBAL DEFAULT  UND add
     6: 0000000000000000     0 NOTYPE  GLOBAL DEFAULT  UND printf
ubuntu@VM-0-9-ubuntu:~/elf-lab$ readelf -s add.o

Symbol table '.symtab' contains 4 entries:
   Num:    Value          Size Type    Bind   Vis      Ndx Name
     0: 0000000000000000     0 NOTYPE  LOCAL  DEFAULT  UND
     1: 0000000000000000     0 FILE    LOCAL  DEFAULT  ABS add.c
     2: 0000000000000000     0 SECTION LOCAL  DEFAULT    1 .text
     3: 0000000000000000    24 FUNC    GLOBAL DEFAULT    1 add
```

能看到`main.o`里的`add`是`UNDEFINED`，而`add.o`的符号表确实提供了这个符号，而且是`GLOBAL`的。

链接器是能抓到这个关系的，根据两者的`.symtab`能建立起符号如何对应。

``` bash
ubuntu@VM-0-9-ubuntu:~/elf-lab$ objdump -d main.o

main.o:     file format elf64-x86-64


Disassembly of section .text:

0000000000000000 <main>:
   0:	f3 0f 1e fa          	endbr64
   4:	55                   	push   %rbp
   5:	48 89 e5             	mov    %rsp,%rbp
   8:	48 83 ec 10          	sub    $0x10,%rsp
   c:	be 14 00 00 00       	mov    $0x14,%esi
  11:	bf 0a 00 00 00       	mov    $0xa,%edi
  16:	e8 00 00 00 00       	call   1b <main+0x1b>
  1b:	89 45 fc             	mov    %eax,-0x4(%rbp)
  1e:	8b 45 fc             	mov    -0x4(%rbp),%eax
  21:	89 c6                	mov    %eax,%esi
  23:	48 8d 05 00 00 00 00 	lea    0x0(%rip),%rax        # 2a <main+0x2a>
  2a:	48 89 c7             	mov    %rax,%rdi
  2d:	b8 00 00 00 00       	mov    $0x0,%eax
  32:	e8 00 00 00 00       	call   37 <main+0x37>
  37:	b8 00 00 00 00       	mov    $0x0,%eax
  3c:	c9                   	leave
  3d:	c3                   	ret
```

`main.o`不知道`add`函数在哪，所以`call add`的时候，那个地址是全零。

上一步符号解析只解决这个`add`到底是哪里定义的，还需要重定位过程解决这里地址的填写。

``` bash
ubuntu@VM-0-9-ubuntu:~/elf-lab$ readelf -r main.o

Relocation section '.rela.text' at offset 0x1d8 contains 3 entries:
  Offset          Info           Type           Sym. Value    Sym. Name + Addend
000000000017  000500000004 R_X86_64_PLT32    0000000000000000 add - 4
000000000026  000300000002 R_X86_64_PC32     0000000000000000 .rodata - 4
000000000033  000600000004 R_X86_64_PLT32    0000000000000000 printf - 4

Relocation section '.rela.eh_frame' at offset 0x220 contains 1 entry:
  Offset          Info           Type           Sym. Value    Sym. Name + Addend
000000000020  000200000002 R_X86_64_PC32     0000000000000000 .text + 0
```

`.rela.*`这类section告诉链接器哪里需要修改。

看`objdump`的输出，`.text`段的`0x16`偏移处是`call add`，其中`e8`是`call`，`0x17`就是实际的需要填的`add`地址，对应了`.rela.text`的第一条。

当`gcc main.o add.o -o main`让链接器同时看到`main.o`和`add.o`时，它的视角大概是这样。

``` txt
main.o

.text
    main

add.o

.text
    add
```

链接器会决定最终的布局。这里的决定方法是由一个默认链接脚本决定的。`ld --verbose`能看。

``` txt
.text

0x401000:
    main

0x401050:
    add
```

有了这个地址，链接器再填回`.rela.*`里告诉链接器需要填的地方。

总结步骤，链接器看各个`.o`文件的`.symtab`符号表，解析应该怎么依赖。合并符号表，最终布局决定以后，去把`.rela.text`里的需要填的地址填好。符号解析+重定位地址，这就是静态链接。

静态链接会把代码都打包进一个文件里，但是`libc`这种库如果让每个C程序都完整持有一份，显然不合理。

动态链接让磁盘甚至内存里都只有一份`libc`的代码。依赖`libc`的进程都链接这一份代码。

动态链接的过程仍然是类似符号解析加重定位的宗旨。

但动态链接发生在运行时。

``` txt
main

.text
    main:
        xxx
    add:
        xxx

.dynamic
    动态库链接需要什么东西（需要什么动态库，动态符号表在哪，重定位表在哪等等）

.plt
    printf跳板

.got
    保存printf真实地址

```

静态链接的`add`最终就会在`ELF`里，所以重定位的时候很方便拿到一个相对地址填到`main`里全是`0`的地方。

但是`printf`的代码段不会进`ELF`。这里会填`call printf@plt`。

`execve`加载一个ELF的时候，如果发现需要动态链接，会先启动动态链接器`ld.so`再跳到`_start`。

动态链接器会看`.dynamic`看需要什么。

`plt(Procedure Linkage Table)`可以理解为一个中转站，会去查`got(Global Offset Table)`。

`got`是一个简单的表，可能就长下面这样。

```
GOT:
+----------------+
| printf地址     |
+----------------+
| malloc地址     |
+----------------+
| xxx地址        |
+----------------+
```

但一开始`got`里面的地址是通向`ld.so`的。

`printf@plt`里的代码会跳到`got`表，然后如果是第一次，通向`ld.so`，由它找到真的`printf`，填到`got`里，后续就不需要再走`ld.so`了。

`got`在这里有点像缓存，之所以不让`ld.so`一次性全部查完，而是有需要的时候一个一个查，是因为有些函数不一定需要查，这样更合理。

其实这里也解释了为什么程序运行的时候不要手动移动动态库位置了，因为`got`里的地址就失效了。除非重启进程。

:::tip
我其实没太理解`plt`有什么用，感觉直接`call printf@got`也可以。
GPT说其实也可以，`plt`的存在有历史原因，有些系统没有`plt`。
:::

## 实验

这是一个Python REPL。

``` bash
# cabbage @ cabbage-Mac in ~/blog on git:main x [19:44:36] C:127
$ python3        
Python 3.13.2 (main, Feb  4 2025, 14:51:09) [Clang 16.0.0 (clang-1600.0.26.6)] on darwin
Type "help", "copyright", "credits" or "license" for more information.
Cmd click to launch VS Code Native REPL
>>> 1 + 1
2
>>> 
```

本次实验实现一个有约束的简易C-REPL。

只支持两个功能：能算表达式，能定义一行返回值为`int`，参数类型都为`int`的函数。

我之前一直以为Python这种解释型语言才能这样，长见识ing...

做法是把每一行输入都放进一个临时的`c`文件，编译成共享库加载执行。

如果是表达式就把它包装成函数（直接返回那种函数），同样编译成共享库加载执行。

本质就是运用`dlopen, dlsym, dlclose`这几个函数。

``` bash
ubuntu@VM-0-9-ubuntu:~/os2026/crepl$ ./crepl 
C REPL - 输入表达式或函数定义

> 1 + 1
2

> int gcd(int a, int b) { return b ? gcd(b, a % b) : a; }
OK: gcd() defined.

> gcd(2, 4)
2

> f()
compile error
```