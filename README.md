# Number Trace

A static personal project that finds the first occurrence of a digit string in locally generated digits of famous constants.

## Supported constants

- pi
- e
- sqrt(2)
- phi

## Run locally

Open `index.html` directly in a browser, or publish the folder with GitHub Pages.

## How it works

- Choose a constant, enter digits, and choose a search range.
- The browser computes digits in a Web Worker with BigInt.
- The browser searches the generated digits locally.
- User input is never uploaded or stored.
- It reports the first decimal interval where the sequence appears.

## Probability note

An 8-digit query has an expected first occurrence around 100,000,000 digits in a random decimal stream. Searching 5,000,000 digits of one constant gives about a 4.9% theoretical hit probability, so long queries can still miss even when the algorithm is working correctly.
