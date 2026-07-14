---
title: Python入门（四）
published: 2026-07-01
description: 'Python独特语法'
image: ''
tags: [阅读, Python]
draft: false
lang: ''
---

## 集合与迭代

``` python
numbers = [1, 2, 3, 4, 5]
for number in numbers:
    print(number)
else:
    print("Finished printing all numbers.")
```

Python里`while`和`for`是可以接`else`的，循环正常结束就会执行，如果循环内部因异常终止的话就不执行。

``` python
letters = ["a", "b", "c"]

first_iterator = letters.__iter__()
second_iterator = letters.__iter__()

print(type(first_iterator)) # <class 'list_iterator'>

print(first_iterator.__next__()) # a
print(first_iterator.__next__()) # b
print(second_iterator.__next__()) # a
print(first_iterator.__next__()) # c
try:
    print(first_iterator.__next__()) # Raises StopIteration
except StopIteration:
    print("StopIteration raised for first_iterator")

iterator = iter(letters)
print(next(iterator)) # a
print(next(iterator)) # b
print(next(iterator)) # c
print(next(iterator, "No more")) # No more
```

可以直接用`__iter__`和`__next__`来获取和使用迭代器。

但总是应该使用Python提供的公共API。功能、类型检查、错误信息都会更强大。比如`next()`可以提供第二个参数，在没有下一个元素时不抛异常，而是返回默认值。

``` python
class Queue:
    def __init__(self):
        self._queue = []
    
    def enqueue(self, item):
        self._queue.append(item)
    
    def __iter__(self):
        return QueueIterator(self._queue)
    
    def __len__(self):
        return len(self._queue)
    
class QueueIterator:
    def __init__(self, queue):
        self._queue = queue
        self._index = 0
    
    def __iter__(self):
        return self
    
    def __next__(self):
        if self._index < len(self._queue):
            item = self._queue[self._index]
            self._index += 1
            return item
        else:
            raise StopIteration
        

queue = Queue()
queue.enqueue(1)
queue.enqueue(2)
for item in queue:
    print(item)
```

需要自定义可迭代类时，一个简单的写法如上。

## 生成器和推导式

``` python
import time

slow_list = [1, time.sleep(1), 2, time.sleep(1), 3]
# Wait for 2 seconds

print(slow_list) # [1, None, 2, None, 3]
```

迭代器的思想本质是惰性求值，当要使用值的时候再进行计算，而不是定义值时就计算。

上面的例子模拟了一个在定义时进行耗时计算的列表。打印语句需要等待两秒。

如果这里的计算极端耗资源，可能卡死，可能Out of Memory。在Python里处理这种情况的最好方法就是惰性求值。

``` python
from itertools import product

def get_license_plate():
    for letter in product('ABCDEFGHIJKLMNOPQRSTUVWXYZ', repeat=3):
        for number in product('0123456789', repeat=3):
            yield ''.join(letter) + ''.join(number)

license_plate_generator = get_license_plate()
print(next(license_plate_generator)) # AAA000
print(next(license_plate_generator)) # AAA001
```

迭代器的一个强大替代品是生成器。含有`yield`语句的函数就是生成器函数。调用它时，会返回一个生成器对象。

每次调用`next`，就会从上次暂停的地方开始执行，直到又碰到`yield`，暂停，返回值。

当生成器函数终止时，不管是执行到末尾，还是提前`return`，都会触发异常`StopIteration`。

可以将迭代器看成一种协议，要求对象实现`__iter__`和`__next__`。而生成器`Generator`对象实现了这个协议，是迭代器的子集，对代码编写者来说用起来更方便。

`Generator`对象内部维护了一个`frame`，存储了指令指针、局部变量、栈。调用`next()`会恢复`frame`从上次停下的字节码位置继续执行。`yield`完又会冻结`frame`。

``` python
from random import randint, choice

colors = ["red", "green", "blue", "yellow", "purple"]
vehicles = ["car", "bike", "truck", "bus", "scooter"]

# 生成一个有2到10辆随机颜色的摩托车的车队
def biker_gang():
    for _ in range(randint(2, 10)):
        color = choice(colors)
        yield f"{color} motorcycle"

# 百分之二的概率生成摩托车队
def traffic():
    while True:
        if randint(1, 50) == 50:
            yield from biker_gang()
            continue
        vehicle = choice(vehicles)
        color = choice(colors)
        yield f"{color} {vehicle}"
```

`yield from`会把执行流转交给另一个生成器。

``` python
# def license_plates():
#     for num in range(10):
#         yield f'ABC {num:03}'

# license_plates = license_plates()

license_plates = (
    f'ABC {num:03}' for num in range(10)
)

for plate in license_plates:
    print(plate)
```

没被注释掉的版本是生成器表达式写法，是语法糖。写起来像把`for`倒过来写。

``` python
g = (x * 2 for x in range(5))

l = [x * 2 for x in range(5)]

s = {x * 2 for x in range(5)}

d = {x: x * 2 for x in range(5)}

print(g)  # <generator object <genexpr> at 0x1002eab50>
print(l)  # [0, 2, 4, 6, 8]
print(s)  # {0, 2, 4, 6, 8}
print(d)  # {0: 0, 1: 2, 2: 4, 3: 6, 4: 8}
```

把生成器表达式的括号变一下就变成了推导式。推导式只是语法糖，也没有惰性求值。

``` python
def echo():
    while True:
        received = yield
        print(f"收到: {received}")

gen = echo()
gen.send(None)
gen.send("hello")  # 收到: hello
gen.send("world")  # 收到: world
```

`yield`出现在等式右边时也可以接收值。这是简单协程的写法，现代Python基本没人用了。

