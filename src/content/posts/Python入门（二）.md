---
title: Python入门（二）
published: 2026-06-22
description: 'Python独特语法'
image: ''
tags: [学习, 阅读, Python]
draft: true
lang: ''
---

这篇记录阅读过程中看到的Python里让我感觉比较意外、反直觉的独特语法。

## 作用域

Python里只有函数和推导式定义了作用域的结构。

``` python
def spam():
    message = "Spam"
    word = "Spam"
    for _ in range(10):
        separator = ","
        message += separator + word
    message += separator
    message += "spam!"
    return message
```

循环是没有作用域的，所以`separator`可以在循环外面用。

``` python
high_score = 10

def score(new_score):
    high_score = new_score

score(100)
print(high_score) # 10
```

如果在函数内部定义和全局变量同名的变量，会shadow掉（如果不定义，只是使用的话不会）。

``` python
high_score = 10

def score(new_score):
    global high_score
    high_score = new_score

score(100)
print(high_score) # 100
```

显式地用`global`关键字能解决这个问题。

``` python
def score():
    val = 1
    def score2():
        nonlocal val
        val = 2
    score2()
    print(val) # 2

score()    
```

类似`global`，在内部函数要修改外部函数的变量时，用`nonlocal`关键字，只是读取的话不需要。

存在多层嵌套的函数时，`nonlocal`的查找顺序是由里向外就近原则。

## 不可变值与可变值


``` python
a = 1
b = a
print(b is a) # True
b += 1
print(b is a) # False
```

Python里整数、浮点数、字符串、元组这类值是不可变的，意味着修改的时候其实是创建一个新内存空间，在里面写新值。

``` python
c = [1, 2, 3]
d = c
print(d is c) # True
d += [4, 5]
print(d is c) # True
```

可变类型比如列表，就是原地更新。

``` python
def find_lowest(numbers):
    numbers.sort()
    return numbers[0]

a = [3, 1, 2]
find_lowest(a)
print(a)  # [1, 2, 3]
```

Python函数传参的语义是“赋值”传递，等于多定义一个变量指向这个值，所以传可变对象的时候函数内变动会对函数外有影响。

``` python
import copy

original = [[1, 2, 3], [4, 5, 6]]

# 普通赋值：只是起了个别名，指向同一个对象
ref = original

# 浅拷贝：外层列表是新的，内层列表仍是原对象的引用
shallow = copy.copy(original)

# 深拷贝：外层和内层列表都是全新的独立副本
deep = copy.deepcopy(original)

# 修改原对象的内层列表
original[0][0] = 999

print(f"original: {original}")   # [[999, 2, 3], [4, 5, 6]]
print(f"ref:      {ref}")        # [[999, 2, 3], [4, 5, 6]] ← 完全一样！
print(f"shallow:  {shallow}")    # [[999, 2, 3], [4, 5, 6]] ← 受影响！
print(f"deep:     {deep}")       # [[1, 2, 3], [4, 5, 6]]   ← 不受影响


original2 = [[1, 2, 3], [4, 5, 6]]
ref2 = original2                      # 普通赋值
shallow2 = copy.copy(original2)       # 浅拷贝
deep2 = copy.deepcopy(original2)      # 深拷贝

# 修改外层列表
original2.append([7, 8, 9])           

print(f"original2: {original2}")      # [[1,2,3], [4,5,6], [7,8,9]]
print(f"ref2:      {ref2}")           # [[1,2,3], [4,5,6], [7,8,9]] ← 一样！
print(f"shallow2:  {shallow2}")       # [[1,2,3], [4,5,6]]          ← 不受影响！
print(f"deep2:     {deep2}")          # [[1,2,3], [4,5,6]]          ← 不受影响

```

上面这个程序能清楚表现普通赋值、浅拷贝、深拷贝的区别。

## 函数签名

Python的函数签名应该是我目前见过的语言里最花里胡哨的了。

``` python
def fib(series=[1,1]):
    series.append(series[-1] + series[-2])
    return series

print(fib()) # [1, 1, 2]
print(fib()) # [1, 1, 2, 3]
```

:::tip
默认参数值只在函数定义（`def`语句执行）时计算一次，不是调用时，所以永远不要在默认参数放一个可变值。
:::

这个坑`Momenta`面试的时候其实被问了，当时不会。

``` python
def fib(series=None):
    if series is None:
        series = [1, 1]
    series.append(series[-1] + series[-2])
    return series

print(fib()) # [1, 1, 2]
print(fib()) # [1, 1, 2]
```

正确的写法是这样的。

``` python
def f(a, b=2, *args, c, d=4, e, **kwargs):
    print(f"a: {a}, b: {b}, args: {args}, c: {c}, d: {d}, e: {e}, kwargs: {kwargs}")

f(1, 2, 3, 4, c=5, e=6, f=7, g=8)
# a: 1, b: 2, args: (3, 4), c: 5, d: 4, e: 6, kwargs: {'f': 7, 'g': 8}
```

Python参数可以分为位置参数和关键字参数。

默认参数和这两个概念是正交的，位置参数和关键字参数都可以有默认值。

`*args`会收走所有多余的位置参数，`**kwargs`会收走所有多余的关键字参数。

有默认值的位置参数一定要放在位置参数的最后。

`*args`后面的参数一定都是关键字参数。

## 闭包

闭包 = 函数 + 它诞生时引用到的外部环境。

``` python
funcs = []
for i in range(3):
    funcs.append(lambda: print(i))

funcs[0]()  # 2
funcs[1]()  # 2
funcs[2]()  # 2

for i in range(3):
    funcs.append(lambda i=i: print(i))

funcs[3]()  # 0
funcs[4]()  # 1
funcs[5]()  # 2
```

闭包捕获的是变量本身，不是变量指向的值。

相当于C++的`[&]`捕获，Python没提供现成的`[=]`捕获

## Lambda

``` python
lambda x, y: x + y
```

相比普通函数更方便作为表达式内嵌

## 装饰器

``` python
def bold(func):
    def wrapper():
        return f"<b>{func()}</b>"
    return wrapper

def italic(func):
    def wrapper():
        return f"<i>{func()}</i>"
    return wrapper

@bold
@italic
def hello():
    return "你好"

print(hello())  # <b><i>你好</i></b>
```

函数套函数的语法糖。

要定义一个装饰器，就要定义一个函数，这个函数接收一个函数，返回一个函数。

``` python
def log(func):
    def wrapper(*args, **kwargs):
        print("调用中...")
        return func(*args, **kwargs)
    return wrapper

@log
def greet():
    """问好"""
    print("你好")

print(greet.__name__)  # wrapper
print(greet.__doc__)   # None  
```

这样的装饰器会让函数本身的重要元信息失效。

``` python
from functools import wraps

def log(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        print("调用中...")
        return func(*args, **kwargs)
    return wrapper

@log
def greet():
    """问好"""
    print("你好")

print(greet.__name__)  # greet
print(greet.__doc__)   # 问好 
```

可以加这样一个装饰器解决。