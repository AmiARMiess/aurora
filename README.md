# Aurora

A landing page for a fictional GPU-accelerated 3D toolkit, built with vanilla
HTML/CSS/JS and [Three.js](https://threejs.org). No build step, no bundler, no
framework — open it and it runs.

A live 3D aurora scene sits behind the content, with a scroll-driven starfield,
orbital rings, and a scroll-reveal system that animates each section in as it
enters the viewport.

<img width="1349" height="4231" alt="image" src="https://github.com/user-attachments/assets/612a8fb5-bddc-41a8-94ba-977de316dbf4" />

## Sections

| Section | Description |
|---|---|
| `#hero` | Headline, call-to-action buttons, and headline stats |
| `#features` | Six feature cards |
| `#process` | Split layout describing the four-step workflow |
| `#stats` | Animated counters (14 kB · 60 fps · 1,200+ · Zero deps) |
| `#contact` | Closing CTA card |

## Running it

> **You need a local web server.** Browsers block ES modules loaded over the
> `file://` protocol, so double-clicking `index.html` will **not** work. Any
> static server works:

```bash
npx serve .
# then open http://localhost:3000
```

Other options:

```bash
python -m http.server 8000
php -S localhost:8000
```

## Tech

- **Three.js** `0.186.1`, loaded from jsDelivr via an inline `importmap`
- `EffectComposer` / `UnrealBloomPass` for the bloom
- Scroll reveals driven by `IntersectionObserver`
- Counters animated with `requestAnimationFrame`
- Custom shaders for the aurora surface and starfield

There are **no runtime dependencies to install** — Three.js is the only external
script, and it comes from a CDN.

## Project structure

```
index.html                    markup, importmap, no-JS / failed-module fallback
styles.css                    all styling, including responsive breakpoints
main.js                       Three.js scene, reveals, counters, nav behaviour
```

## Graceful degradation

The page is designed to remain fully readable even when JavaScript fails to
run — opened over `file://`, with the CDN blocked, or with JS disabled
entirely.

Three progressive enhancements are applied in markup/CSS and only ever undone by
`main.js`:

- `body.is-loading` → `overflow: hidden`
- `.preloader` → `position: fixed; inset: 0; z-index: 300`
- `[data-reveal]` → `opacity: 0`

If the module never executes, these would otherwise trap the visitor behind an
undismissable overlay with no way to scroll. An inline bootstrap script — which
*does* run on `file://` — restores the page and arms a 4-second failsafe for
slow or blocked module loads. `main.js` cancels that failsafe once it boots.

In degraded mode the content sits on the CSS gradient background instead of the
3D scene, and all sections and counters render normally.
