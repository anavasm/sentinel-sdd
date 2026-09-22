# 🛡️ Sentinel SDD — AI Code Review & DevSecOps Platform

[![SDD Architecture](https://img.shields.io/badge/Architecture-SDD%20%2F%20Spec--Driven-blueviolet)](./specs)
[![Microfrontend](https://img.shields.io/badge/Frontend-Microfrontends%20%28Module%20Federation%29-blue)](https://react.dev/)
[![Testing Strategy](https://img.shields.io/badge/Testing-Vitest%20%7C%20RTL%20%7C%20Playwright-green)](#-testing-strategy)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Pet Project / Proof of Concept**  
> A project designed to practice **Spec-Driven Development (SDD)**, distributed **React Microfrontend architectures**, and an advanced **Testing Strategy (Unit, Integration & E2E)** applied to real-time AI code observability and auditing.

---

## 🎯 Project Purpose

**Sentinel SDD** is a command center for engineering teams that enables real-time repository auditing via autonomous AI agents. The platform analyzes security vulnerabilities (OWASP Top 10), code quality, and test coverage, streaming logs live and suggesting automated refactorings.

The primary goal of this repository is to demonstrate a rigorous engineering workflow within a strict 15-day timeline—prioritizing architecture, formal upfront specification, and code quality over raw code generation.

---

## 📐 SDD Methodology (Spec-Driven Development)

In this project, **the specification is the Single Source of Truth**. No component or endpoint is implemented without a prior formal contract or spec located in the `/specs` directory.

### Workflow
1. **Specification:** Definition of API contracts (`openapi.yaml`), SSE event schemas (`events-schema.json`), and user stories in Gherkin format.
2. **Validation:** Internal SDD-capable agent validates contracts and generates initial skeletons/mocks.
3. **Guided Development:** Manual implementation (human-in-the-loop) of the frontend and integration logic strictly following the contracts.
4. **Verification:** Automated test suites executed against the defined specifications.

---

## 🛠️ Tech Stack & Architecture

### 🏛️ Architecture & Monorepo
* **Monorepo Management:** `pnpm` Workspaces + `Turborepo`
* **Microfrontends (MFE):** Vite + `@originjs/vite-plugin-federation` (Module Federation)
  * `mfe-shell` (Host Orchestrator)
  * `mfe-config` (Remote 1: Audit Form & Rules Configuration)
  * `mfe-metrics` (Remote 2: Live SSE Dashboard, Metrics & Refactoring)

### ⚛️ Frontend (Hands-on Development)
* **Core:** React 18 / 19 + TypeScript
* **State & Data Fetching:** React Query / TanStack Query + Custom SSE Hooks
* **Styling:** Tailwind CSS

### 🤖 AI Agent & Communication
* **Agent Engine:** Custom CLI Agent with SDD capabilities
* **Real-Time Stream:** Server-Sent Events (SSE) for streaming live thoughts, actions, and findings.

### 🧪 Testing Strategy (Testing Trophy)
* **Unit & Integration Tests:** `Vitest` + `React Testing Library` (>80% coverage target on critical components and hooks).
* **API Mocking:** `MSW` (Mock Service Worker) based on OpenAPI specifications.
* **End-to-End (E2E):** `Playwright` to test seamless integration between the Shell App and Remote Microfrontends.

---

## 📂 Project Structure

```text
sentinel-sdd/
├── apps/
│   ├── mfe-shell/        # Host Application (Main Orchestrator)
│   ├── mfe-config/       # Remote MFE: Audit Configuration
│   └── mfe-metrics/      # Remote MFE: SSE Console & Metrics Dashboard
├── packages/
│   ├── ui/               # Shared UI Component Library
│   └── tsconfig/         # Shared TypeScript Configurations
├── specs/                # 📜 SDD - Single Source of Truth
│   ├── openapi.yaml      # REST API Contract (Audits)
│   ├── events.json       # Server-Sent Events (SSE) Schema
│   └── features/         # Functional Specs in Gherkin (.feature)
└── README.md
```

## 🚀 Quick Start Guide
Prerequisites
- Node.js >= 20.x
- pnpm >= 9.x

## Installation & Execution

### 1. Clone the repository
git clone [https://github.com/anavasm/sentinel-sdd.git](https://github.com/anavasm/sentinel-sdd.git)
cd sentinel-sdd

### 2. Install monorepo dependencies
pnpm install

### 3. Run development environment (Shell + MFEs)
pnpm dev

### 4. Run test suite
pnpm test