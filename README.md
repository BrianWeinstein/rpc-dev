# DEV 🚧🚧🚧🚧🚧
# Real Photo Camera 3100

A silly little camera webapp.

## Description

Given a photo, the app first uses the Gemini API to generate a detailed description of the photo. Next, the description is then used as a prompt for the Imagen API, which creates a new version of the original image.

The new image is errily similar to the original. _What is a photo?_

## Bad code
Gemini wrote the majority of this code (AI writing an AI app), and part of the fun of this project was doing anything and everything Gemini told me to do. It instructed me to do some stupid stuff, like publicly exposing my API key (fear not: I put some hard restricitons on the key's usage). Errors are handled poorly too. A lot of this code is garbage.

## License & usage

MIT License, Copyright (c) 2025 Brian Weinstein. See [LICENSE](LICENSE) for more info.

Don't use this app for bad stuff.