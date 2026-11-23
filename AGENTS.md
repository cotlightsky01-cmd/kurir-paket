# Project Rules & AI Agent Instructions

## Critical Analysis & Risk Warning Protocol
- **Analyze Before Executing**: For any user instruction, carefully evaluate the request, dependencies, system integrity, and potential breaking points before making edits or running commands.
- **Challenge High-Risk Requests**: If a requested instruction carries a high risk of failure, data loss, regression, or poor user experience:
  1. Do NOT immediately apply destructive or breaking code changes.
  2. Clearly explain the specific technical or operational risks.
  3. Offer a safer, standard, or optimized alternative approach to achieve the goal.

## Business Logic Rules
1. **Receiver Extraction**:
   - `name`: Clean pure name only (no package counts, parentheses like `(2 paket)`, or order numbers).
   - `address`: Strip `JAWA TENGAH`, `Jawa Tengah`, `INDONESIA`, and 5-digit postal codes automatically.
   - `phone`: Strictly extract visible phone numbers from the image without arbitrary placeholder defaults.
2. **WhatsApp Target**:
   - Support `whatsapp-business://` deep-linking when sending messages from sending modules, with a fallback toggle switch for standard WhatsApp (`api.whatsapp.com`).
