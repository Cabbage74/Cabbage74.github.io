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



## 实验

