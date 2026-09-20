/// <reference types="vite/client" />

declare module '*.mp4' {
    const src: string
    export default src
}

declare module '*.svg' {
    const src: string
    export default src
}

declare module '*.svg?raw' {
    const src: string
    export default src
}
