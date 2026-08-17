---
title: LibKVDB
published: 2026-08-16
description: 'JYY OS 2026 M9'
image: ''
tags: [OS]
draft: false
lang: ''
---

## 理论

最后两节JYY广度优先地讲了计算机安全和虚拟化的一些东西。

让“一套服务感觉自己在独占机器”有两条路线。

一条是SOSP1997论文Disco为起点，VMWare为代表的思路。

一条是利用Linux自带的Namespace和Cgroup做隔离，Docker把这套做成了一个标准化又易用的产品。

## 实验

实现一个Crash Safe的简易KV DB。

不要求性能，一把大锁加Write Ahead Log即可。

