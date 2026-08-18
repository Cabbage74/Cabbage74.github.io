---
title: Python入门（一）
published: 2026-06-20
description: '包与虚拟环境'
image: ''
tags: [Python]
draft: false
lang: ''
---

由于实习工作需要用到很多Python，并且之前一直拿Python当脚本语言用，基础不扎实。

这个系列记录《Python编程从新手到高手》的阅读过程，希望厘清之前没能力弄懂和没意愿弄懂的知识。

## 包与虚拟环境

包就是Python里的第三方库。

一个系统下不同项目的包可能有版本冲突，可以通过虚拟环境解决。相当于给每个项目配一个沙盒。

:::tip
不过虚拟环境在实现上和项目是解耦的，所以其实可以创造一些系统级别的通用虚拟环境。
:::

### 这里讨论虚拟环境的使用

``` bash
python3 -m venv venv
```

该命令在当前目录创建一个虚拟环境，第一个venv表示调用Python提供的venv工具，第二个venv表示相对路径。

``` bash
source venv/bin/activate
```

该命令激活虚拟环境。

``` bash
deactivate
```

该命令退出虚拟环境。

### 这里讨论虚拟环境的原理

``` markdown
我的项目/
├── venv/              ← 虚拟环境根目录
│   ├── bin/           ← Linux/macOS 下的可执行文件
│   │   ├── python     ← Python解释器的符号链接
│   │   ├── pip        ← 独立的包管理器
│   │   └── activate   ← 激活脚本
│   ├── lib/
│   │   └── python3.x/
│   │       └── site-packages/  ← 第三方包安装位置（每个虚拟环境独有）
│   └── pyvenv.cfg     ← 配置文件
```

这是创建虚拟环境后一个比较经典的venv文件夹构成。

激活脚本做了以下事情：

- 保存当前旧PATH。

- 修改PATH：把虚拟环境路径放到PATH最前面。比如原本的PATH是`/usr/local/bin:/usr/bin:...`，那么修改后就是`/Users/cabbage/python-lab/venv/bin:/usr/local/bin:/usr/bin:...`。

- 设置`VIRTUAL_ENV`环境变量`VIRTUAL_ENV=/Users/cabbage/python-lab/venv`。`VIRTUAL_ENV`是Python生态的一个约定俗成变量，下游工具都认它。比如pip看到这个变量就知道包要装到venv的site-packages里，而不是系统级别的site-packages里。

- 修改提示符前缀 (venv)。

- 定义deactivate函数用于恢复。

为什么激活脚本好像只是简单改个PATH就实现了隔离呢？

关键在于 `pyvenv.cfg` 文件。Python 解释器启动时会做一件事：

1. 拿到自己的路径 `sys.executable`（比如 `.../venv/bin/python`）
2. 从这个路径向上查找 `pyvenv.cfg`
3. 找到了，就读取配置，把 `sys.path` 里的系统 `site-packages` 替换成 venv 的 `site-packages`

`sys.path` 是 Python 内部的一个列表，控制 `import` 时去哪里找模块——
和 shell 的 `PATH` 原理一样，只是找的是 `.py` 文件而非可执行文件。

所以隔离不是靠`PATH`实现的，`PATH`只负责让 shell 找到 venv 里的
python 和 pip。真正的包隔离靠的是 Python 启动时自己读了 `pyvenv.cfg`
然后改了 `sys.path`。

## 虚拟环境相关的Python生态产品

venv只解决了一个问题：在一个Python版本下隔离包。现实中的需求比这复杂得多，这些工具就是来填补其他空白的。

### conda

还能管理Python版本以及一些Python包底层依赖的C库和Fortran库。

在机器学习领域使用很多。

### poetry

npm/cargo风格的Python包管理。

### uv

和poetry类似，因为是用Rust写的，性能很好。

