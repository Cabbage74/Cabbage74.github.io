---
title: React组件化
published: 2026-06-30
description: 'React的组件化思想'
image: ''
tags: [学习, 全栈]
draft: false
lang: ''
---

上一节里，构建工具承担了“翻译官”的角色。将开发者写起来舒服的代码“翻译”成浏览器看起来舒服的代码。

构建工具可以“翻译”，意味着我们可以写出规则更加不同的代码，只要最后让构建工具“翻译”成浏览器看得懂的html/css/js就行了。

React是最火的前端框架，核心思想是把复杂页面拆成可复用的组件，通过数据驱动组件更新。

``` bash
npm install react react-dom
npm install -D @vitejs/plugin-react
```

NPM安装react相关依赖、能让Vite知道怎么翻译react的插件。

``` js title="vite.config.js"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
```

安装完还得编写Vite的配置文件vite\.config\.js，真正地“插”上插件。

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=NDA4MTg5NDNjZmFjYTA5OTA5ZmRkOGIwNTdhYTc2MjRfYmU0ZmQzMzcyOTY3ZTNmZWY3ZjUxZjQyYzUxMDJjNDhfSUQ6NzY1NzE2Nzk5ODI5NzY0MDE1OV8xNzgyODI2NjE1OjE3ODI5MTMwMTVfVjM)

``` html title="text-lab.html"
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Zero to Tech · 文字实验室</title>
    <link rel="stylesheet" href="css/reset.css" />
    <link rel="stylesheet" href="css/variables.css" />
    <link rel="stylesheet" href="css/layout.css" />
    <link rel="stylesheet" href="css/hero.css" />
    <link rel="stylesheet" href="css/nav.css" />
    <link rel="stylesheet" href="css/cards.css" />
    <link rel="stylesheet" href="css/lab.css" />
    <link rel="stylesheet" href="css/responsive.css" />
  </head>
  <body>
    <div class="app-shell">
      <div class="page-shell">
        <main class="page-content">
          <section class="dashboard-grid">
            <article class="hero-stage panel-full">
              <div class="hero-topline">
                <p class="brand-eyebrow">zero to tech</p>
                <nav class="inline-links hero-nav">
                  <a class="nav-link" href="index.html">个人主页</a>
                  <a class="nav-link" href="text-lab.html">文字实验室</a>
                </nav>
              </div>
              <div class="hero-copy">
                <h1 class="hero-display">文字实验室</h1>
                <p class="hero-subtitle">拼音和情绪，挖掘中文里的细节</p>
              </div>
            </article>

            <article class="panel panel-half lab-panel card">
              <div class="panel-heading">
                <p class="section-kicker">输入区</p>
                <h3>贴一段中文</h3>
              </div>
              <form class="lab-form">
                <label for="text-input">文本内容</label>
                <textarea
                  id="text-input"
                  rows="8"
                  placeholder="例如：生活没有标准答案，但每一天都值得认真感受。"
                >今天的风很轻，适合把脑海里的想法慢慢写下来。</textarea>
                <button class="primary-button" type="button">开始分析</button>
              </form>
            </article>

            <article class="panel panel-half lab-panel result-panel card">
              <div class="panel-heading">
                <p class="section-kicker">结果区</p>
                <h3>分析结果</h3>
              </div>
              <div class="result-stack">
                <div class="result-item">
                  <span>原文</span>
                  <p>今天的风很轻，适合把脑海里的想法慢慢写下来。</p>
                </div>
                <div class="result-item">
                  <span>拼音</span>
                  <p>jīn tiān de fēng hěn qīng …</p>
                </div>
                <div class="result-grid">
                  <div class="result-badge">
                    <span>情感分数</span>
                    <strong data-score>0.86</strong>
                  </div>
                  <div class="result-badge">
                    <span>情感判断</span>
                    <strong>偏积极</strong>
                  </div>
                </div>
              </div>
            </article>

          </section>
        </main>
      </div>
    </div>

    <script type="module" src="js/main.js"></script>
  </body>
</html>
```

对于文字实验室text\-lab\.html这个文件，现在是vanilla的写法。html把页面结构写的很长，而且要写新的一页还是得写这么长。

其实可以按导航Nav、输入卡片InputCard等拆成可复用的组件。很多页面可以复用导航Nav。

html/css/js就像是后端的controller/service/repository按技术切分。React就像是后端按业务切分服务一样切分出组件。

``` js title="Nav.jsx"
// Nav 原本在 index.html 和 text-lab.html 各抄了一遍。
// 现在它是一个组件，整个项目只有这一份。
// 想加链接、改样式？只改这一处，两个页面自动一起跟着变。
export default function Nav({ current, onNavigate }) {
  const items = [
    { key: "home",    label: "个人主页" },
    { key: "textlab", label: "文字实验室" },
  ];

  return (
    <div className="hero-topline">
      <p className="brand-eyebrow">zero to tech</p>
      <nav className="inline-links hero-nav">
        {items.map((it) => (
          <a
            key={it.key}
            href="#"
            className={"nav-link" + (current === it.key ? " active" : "")}
            onClick={(e) => { e.preventDefault(); onNavigate(it.key); }}
          >
            {it.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
```

以导航Nav\.jsx为例。一个jsx文件一般对应一个组件，一个组件就像是一个函数，输出一段由**运行时输入**决定的类似html的结构。这个结构经过React和Vite最终会变成真的html。容易想象每个组件都是一个动态的DOM子树，由React来动态地创建、修改、销毁。

``` js title="TextLabPage.jsx"
import Nav from "./Nav.jsx";
import PageHeading from "./PageHeading.jsx";
import AnimatedCardGrid from "./AnimatedCardGrid.jsx";
import InputCard from "./InputCard.jsx";
import ResultCard from "./ResultCard.jsx";

// 整页就是几块积木拼起来的：导航、标题、输入卡、结果卡。
// TextLabPage 这个"大组件"，把这些小组件摆在一起，拼成一整页。
export default function TextLabPage({ current, onNavigate }) {
  return (
    <AnimatedCardGrid className="dashboard-grid">
      <article className="hero-stage panel-full">
        <Nav current={current} onNavigate={onNavigate} />
        <PageHeading title="文字实验室" subtitle="拼音和情绪，挖掘中文里的细节" />
      </article>

      <InputCard />
      <ResultCard />
    </AnimatedCardGrid>
  );
}
```

再看含有Nav的页面TextLabPage\.jsx。其实和Nav没什么区别，Nav像是小积木，TextLabPage像是大积木。

![Image](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=Y2ZkMDg0YzcyNThmMzM4NzNkNDEwNTcxNmI5MjM2NzVfYzAwMGM5M2JkZmVjOTFmOTg0MzFiNTQyM2VjNTUxMGFfSUQ6NzY1NzE3NjE4MzUxMTMyMTU0OF8xNzgyODI2NjE1OjE3ODI5MTMwMTVfVjM)

Vanilla写法里，不同的页面一般就是不同的html。

``` js title="App.jsx"
import { useState } from "react";
import HomePage from "./components/HomePage.jsx";
import TextLabPage from "./components/TextLabPage.jsx";

export default function App() {
  // page 是个"状态"——它一变，下面的界面就跟着重新渲染。
  // 这一节先把它当"框架的规则"用、不展开
  const [page, setPage] = useState("home");

  return (
    <div className="app-shell">
      <div className="page-shell">
        <main className="page-content">
          {page === "home"
            ? <HomePage current={page} onNavigate={setPage} />
            : <TextLabPage current={page} onNavigate={setPage} />}
        </main>
      </div>
    </div>
  );
}
```

React里每个页面都是一个组件，可以把它们合成一个最大的组件App\.jsx。切换页面不再是切换html，而是切换组件。写完App\.jsx就写完了最大的一个组件。

``` js title="main.jsx"
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

import "./css/reset.css";
import "./css/variables.css";
import "./css/layout.css";
import "./css/hero.css";
import "./css/nav.css";
import "./css/cards.css";
import "./css/lab.css";
import "./css/responsive.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

``` html title="index.html"
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Zero to Tech</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

把index\.html和main\.jsx结合起来看，就知道组件是怎么和html连接起来的了。

React项目里，只有一个空的div，dom树一开始是空的。main\.jsx这个脚本告诉React要渲染root这个div。

容易发现这种React项目里只有一棵DOM树。

传统Vanilla写法：每个 HTML 文件被加载时，浏览器直接解析该 HTML，构建出整棵 DOM 树。切换页面时，旧 DOM 树被完全销毁，浏览器加载新 HTML，构建一棵全新的 DOM 树。

React写法：整个应用只有一个 HTML 文件。里面有个容器，比如 root div。React接管这个div，然后动态地在这个div内部创建、更新、销毁 DOM 节点，来模拟“页面切换”。浏览器只加载一次 HTML，后续的“页面”切换，都是 React 在这个 root div 里面变魔术。

``` text
├── README.md
├── index.html
├── package-lock.json
├── package.json
├── src
│   ├── App.jsx
│   ├── components
│   │   ├── AnimatedCardGrid.jsx
│   │   ├── HomePage.jsx
│   │   ├── InputCard.jsx
│   │   ├── Nav.jsx
│   │   ├── ...
│   ├── css
│   │   ├── cards.css
│   │   ├── hero.css
│   │   ├── ...
│   └── main.jsx
└── vite.config.js
```

这是一个React项目的经典结构。



