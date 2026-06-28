---
title: Python入门（三）
published: 2026-06-28
description: 'Python独特语法'
image: ''
tags: [学习, 阅读, Python]
draft: true
lang: ''
---

## 类

``` python
class A:
    def __new__(cls, *args, **kwargs):
        return super().__new__(cls)

    def __init__(self, value):
        self.value = value

    def display(self):
        print(f"Value: {self.value}")

    def __del__(self):
        print(f"Deleting instance with value: {self.value}")

a = A(10)
a.display() # Value: 10

b = a
del a
b.display() # Value: 10

# Deleting instance with value: 10
```

别的语言的构造函数被Python分成了两块。`__new__`负责内存分配，这个内存是固定大小的，只放对象的骨架。这块固定的内存里有一个空字典`__dict__={}`。

`__init__`负责初始化属性，在这里第一次定义的变量就是放在`__dict__`指向的地方。

`self.value = 10`本质是`self.__dict__['value'] = 10`。

`__del__`是析构函数，引用计数为零的时候就会被调用。

手动调用`del`只会让引用计数减一，不会强制回收内存里这块值。

``` python
class A:
    name = "Class A"

    def __init__(self, value):
        self.value = value

    version = 1.0
    _speed = 100
    __hidden = "This is a hidden attribute"

    def display(self):
        print(f"Value: {self.value}")

    
print(A.name)  # Class A
print(A.version)  # 1.0
print(A._speed)  # 100
print(A._A__hidden)  # This is a hidden attribute
```

不在方法里的属性都是类属性。

在属性前面加一个下划线是约定“不要访问我”，但硬要访问也可以。

加两个下划线是让编译器改名，但这个改名的模式是可预测的。一般用于防止子类意外覆盖父类的同名属性。

``` python
class A:
    name = "Class A"

    def __init__(self, value):
        self.value = value

    @classmethod
    def get_name(cls):
        return cls.name

    @staticmethod
    def add(a, b):
        return a + b

    @property
    def info(self):
        return f"{self.__class__.__name__}(value={self.value})"


print(A.get_name())       # Class A
print(A.add(1, 2))        # 3

a = A(10)
print(a.info)             # A(value=10)
```

`@classmethod`修饰的是类方法，第一个参数是类本身，所以通常只访问类属性。

`@staticmethod`修饰的是静态方法，类似工具函数。

`@property`修饰的让方法能像属性一样被访问。

这三个装饰器的原理和普通的函数套函数语法糖不一样，是基于描述符协议实现的。经过我和AI的讨论，我决定姑且把它们记作Python的特殊实现，描述符协议我不打算深入了解。

一般情况下，Python的装饰器有两个用法，一个就是普通的函数套函数语法糖，一个是给函数注入一些元信息方便框架进行扫描。

``` python
class A:
    def __init__(self, value):
        self.value = value

    def __str__(self):
        return f"A(value={self.value})"

    def __lt__(self, other):
        return self.value < other.value
 
    def __call__(self, x):
        return self.value + x


a = A(10)
print(str(a))           # A(value=10)
print(a < A(20))        # True
print(a(5))             # 15
```

Python里以两个下划线开头和结尾的是特殊方法，大概有100多个。这里我挑了三个。

`__call__`很有意思，让类能被调用。`def`本质就是创建了一个`function`的实例对象，而`function`类实现了`__call__`。

## 错误和异常

``` python
def make_guess():
    guess = int(input("Guess a number between 1 and 10: ")) # fifty
    return guess

guess = make_guess()

# Traceback (most recent call last):
#   File "/Users/cabbage/python-lab/main.py", line 5, in <module>
#     guess = make_guess()
#   File "/Users/cabbage/python-lab/main.py", line 2, in make_guess
#     guess = int(input("Guess a number between 1 and 10: "))
# ValueError: invalid literal for int() with base 10: 'fifty'
```

Python的异常自底向上读，是由近向远的调用栈。