# Demos

Both demos are the published package running in your browser. The first click on a card downloads that card's model (23 to 105 MB); after that the browser cache serves it.

- <SiteLink to="/demo/">Demo app</SiteLink>: `projects/demo`, an Angular CLI app with every wrapper on one page. Its pipelines run in a [Web Worker](./web-workers), the sentiment card classifies as you type through [`inferenceResource()`](./reactive-inference), and the generation card streams.
- <SiteLink to="/storybook/">Storybook</SiteLink>: one story per wrapper, plus the progress component with controls.

<DemoFrame />

Dictation needs microphone permission. The embedded frame asks for it; if your browser refuses inside frames, open the demo full screen.
