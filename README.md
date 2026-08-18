# JSON Viewer & Previewer

A fast, lightweight, and interactive web tool to format, validate, inspect, and visualize JSON data in real time.

---

## Features

- **Interactive Tree View**: Collapsible nodes, depth toggles, and item counters for large nested objects and arrays.
- **Syntax Highlighting & Formatting**: Beautify with customizable indentation (2 or 4 spaces) or minify into a single line.
- **Real-Time Validation & Error Highlighting**: Instant JSON linting with exact line and column error indicators.
- **Search & Path Extraction**: Search keys/values and copy direct JSON paths (e.g., `data.users[0].name`) or raw values with a click.
- **Multiple Input Modes**: Paste raw text, upload `.json` files, or fetch JSON directly via URL.
- **Dual View Modes**: Switch seamlessly between raw text editor and visual tree inspector.
- **Privacy-Focused**: Client-side processing—no data is sent to external servers.

---

## Tech Stack

- **Frontend**: React / Next.js *(or HTML5 / Tailwind CSS / Vanilla JS)*
- **Icons**: Lucide React
- **Code Editor / Parser**: Monaco Editor / CodeMirror / PrismJS

---

## Getting Started

### Prerequisites

Ensure you have [Node.js](https://nodejs.org/) installed (v18 or higher recommended).

### Installation

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/your-username/json-viewer.git](https://github.com/your-username/json-viewer.git)
   cd json-viewer