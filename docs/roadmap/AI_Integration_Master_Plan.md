# AI Integration Master Plan: "Project Cerebro"

> **North Star**: Transform the application from a "Recording System" (passive) to an "Intelligence System" (active & predictive), powered by Gemini 1.5.

## 1. Executive Summary
This roadmap outlines the integration of Generative AI across two key pillars:
1.  **Command Center Intelligence**: Predictive analytics, natural language querying (NLQ), and automated executive reporting.
2.  **Operations Copilot (Help System)**: Context-aware assistance, standard operating procedure (SOP) guidance, and proactive error resolution.

## 2. Technical Architecture
To support these features securely and scalably:

### Backend (Firebase Cloud Functions 2nd Gen)
*   **Runtime**: Node.js 20.
*   **AI Engine**: Vertex AI SDK for Firebase (Gemini 1.5 Pro/Flash).
*   **Security**: All API keys are server-side; Frontend uses Callable Functions (`askGemini`, `analyzeData`).

### Data Layer (Vector Embeddings)
*   **Store**: Firestore Vector Search (or Pinecone).
*   **Purpose**: Enable semantic search over:
    *   Help Documentation (SOPs).
    *   Product Catalog (for fuzzy matching).
    *   Historical Incident Reports.

## 3. High-Impact Workstreams

### A. Command Center (Strategic)
*   **Objective**: Empower decision-makers with instant answers and forecasts.
*   **Key Features**:
    *   **Natural Language BI**: "Show me sales growth for Michelin tires last month vs. year prior."
    *   **Predictive Inventory**: "Which SKUs will stock out in the next 14 days?" (Time-series forecasting).
    *   **"Morning Briefing" Generator**: Auto-compiles a PDF summary of yesterday's performance + today's risks.

### B. Help System (Operational)
*   **Objective**: Reduce training time and error rates for staff.
*   **Key Features**:
    *   **Context-Aware Copilot**: Chat widget that knows *who* the user is and *what* page they are on.
    *   **Interactive Tours**: AI agents that highlight UI elements to guide completion of complex tasks (e.g., Returns).
    *   **Error Doctor**: Explains *why* an action failed (e.g., "Assignee not found") and suggests the fix.

## 4. Implementation Phasing

### Phase 1: Foundation (Weeks 1-2)
*   [ ] Firebase Plan Upgrade to Blaze.
*   [ ] Initialize Cloud Functions.
*   [ ] Deploy basic `askGemini` endpoint.

### Phase 2: Operations Copilot (Weeks 3-4)
*   [ ] Vectorize `HelpContentService` topics.
*   [ ] Implement "Ask Ops" chat widget.

### Phase 3: Command Center BI (Weeks 5-8)
*   [ ] Implement "Text-to-Query" (NLQ) for Firestore.
*   [ ] Launch Smart Briefing v2 (LLM-powered).
