# Skill: Security Audit Security Guardrails

These instructions must be strictly followed whenever performing, reviewing, or generating security audit documents, reports, or remediation scripts.

## 🚨 MANDATORY REQUIREMENT: ZERO CREDENTIAL EXPOSURE

> [!CRITICAL]
> **API keys, secrets, passwords, tokens, and private connection strings must NEVER be written to or committed in any security report, log, markdown file, or source code.**

### 1. Plaintext Key Redaction Rule
If a vulnerability audit or remediation documentation references an active API key or secret (e.g., from `.env`, `.env.local`, or server-side configs), you **MUST** mask or redact the key. 

* **❌ NEVER DO THIS:**
  ```markdown
  GEMINI_API_KEY=AIzaSyC_D1KM5TslIVJIHylQc2Mzruq8QV6kDfo
  ```
* **✅ ALWAYS DO THIS:**
  ```markdown
  GEMINI_API_KEY=AIzaSy...[REDACTED_FOR_SECURITY]
  ```

---

### 2. Pre-Save Sanity Check
Before writing, updating, or saving any file starting with `Security` or containing security checklists:
1. Scan the content for common API key headers (e.g., `AIzaSy`, `sk-`, `ey`, `Bearer`, `ssh-rsa`, `passwd=`).
2. Replace any raw key values with explicit mock placeholders (e.g., `AIzaSy...[REDACTED]`, `your-api-key-here`).
3. Ensure the file containing the actual credentials (like `.env`) remains tracked exclusively in your local environment, never referenced directly with plaintext contents in tracked files.

---

### 3. Immediate Remediation of Leaks
If a plaintext key is accidentally committed:
1. **Immediately alert the user** in the chat interface that the key has been exposed and must be rotated in the respective cloud/API console.
2. Replace the key in the source file with a redacted placeholder immediately.
3. Inform the user how to clean the git history using `git-filter-repo` or BFG Repo-Cleaner to completely remove the exposed key from historical commits.
