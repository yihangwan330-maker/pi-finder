# Number Trace

A dynamic personal project that finds the first occurrence of a digit string in chunked datasets of famous constants.

## Supported constants

- pi
- e
- sqrt(2)
- phi

## Run locally

```bash
npm start
```

Then open:

```text
http://localhost:8000
```

## How it works

- Choose a constant, enter digits, and choose a search range.
- The frontend calls the backend `/api/search` endpoint.
- The backend requires `data/<constant>/manifest.json` plus chunked digit files.
- The backend searches chunk files without storing user input.
- It reports the first decimal interval where the sequence appears.

The backend does not store user input. No demo calculation mode is used in the production version.

## Prepare large digit data

Put a plain text file of decimal digits somewhere, then split it into chunks:

```bash
node tools/chunk-digits.js pi path/to/pi-digits.txt data/pi 1000000
node tools/chunk-digits.js e path/to/e-digits.txt data/e 1000000
```

The script creates `manifest.json` plus `chunk-000000.txt`, `chunk-000001.txt`, and so on. Once those files exist, that constant becomes searchable.
