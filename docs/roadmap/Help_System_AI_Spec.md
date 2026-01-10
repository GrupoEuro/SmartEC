# Help System AI Specification: "Ops Copilot"
> Focus: Contextual Assistance, Training, and Error Resolution.

## 1. The "Ops Copilot" Chatbot
**Goal**: A persistent assistant that answers "How-to" and "What-is" questions.

### Architecture
*   **Context Window**: Injects the **Current Page URL** and **User Role** into system prompt.
*   **Knowledge Base**:
    *   **Static**: Existing `HelpContentService` topics.
    *   **Dynamic**: Real-time status definitions (e.g., "What does 'Allocated' mean?").

### Sample Dialogue
*   **User**: "I can't find the 'Approve' button for this order."
*   **Copilot**: "This order is in `Pending Payment` status. It must be `Paid` or `cod_approved` before you can fulfill it. Check the Payment Widget."

## 2. Interactive "Driver" Tours
**Goal**: On-screen guidance for complex workflows.

### Implementation
*   **Trigger**: User asks "Show me how to receive stock" OR clicks "Guide Me" on Inventory Page.
*   **Technology**: `angular-shepherd` or `driver.js`.
*   **AI Role**: Generates the tour steps dynamically based on the *current* form state (e.g., skipping filled fields).

## 3. Intelligent Error Handling
**Goal**: Minimize support tickets for common validation errors.

### Mechanism
*   **Trigger**: Frontend `HttpErrorResponse` or Form Validation Error.
*   **Action**: Send error code + context to `explainError` Cloud Function.
*   **Output**: User-friendly toast message.
    *   *Raw*: `409 Conflict: SKU_EXISTS`
    *   *AI*: "You entered SKU `MIC-123`, but that already exists for 'Michelin Pilot Sport'. Did you mean to edit that product instead?"
