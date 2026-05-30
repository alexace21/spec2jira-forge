# EPIC: Spec2JIRA Platform — MVP Release to Market

**Epic Key:** S2J-1
**Epic Owner:** Alex Asenov
**Priority:** Critical
**Target Release:** Q3 2026
**Status:** Planning
**Labels:** mvp, platform, saas, infrastructure, ml-pipeline

---

## 1. Executive Summary

Spec2JIRA е AI-powered платформа, която трансформира Confluence спецификации в структурирани JIRA work items чрез fine-tuned Phi-3 модели с LoRA адаптери. Платформата е предназначена за банки и регулирани индустрии в EU+US, с on-premise deployment опция и пълна проследимост (audit trail).

Този EPIC покрива пълния scope на MVP release — от инфраструктурата до продуктовата функционалност, включително: cloud среда, user management, SaaS billing, ML inference pipeline, Atlassian интеграции, CI/CD, мониторинг, сигурност и demo/trial инфраструктура.

**Бизнес цел:** Първи 3 paying customers в CEE banking сектора в рамките на 6 месеца след launch.

**Технологичен стек:**
- Frontend: React 18 + TypeScript + Tailwind CSS
- Backend: Java 21 + Spring Boot 3.2 + Spring Security
- ML Engine: Python 3.11 + FastAPI + Transformers + PEFT (LoRA)
- Database: PostgreSQL 16 + Redis 7
- Message Queue: Apache Kafka 3.7
- Cloud: Google Cloud Platform (GKE, Cloud SQL, Cloud Storage, Artifact Registry)
- IaC: Terraform + Helm Charts
- CI/CD: GitHub Actions + ArgoCD
- Monitoring: Prometheus + Grafana + ELK Stack
- Auth: Keycloak 24 (OIDC/SAML)

---

## 2. Архитектурен преглед

### 2.1 High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    LOAD BALANCER (GCP LB)                   │
│                   ┌─── api.spec2jira.io ───┐                │
│                   │   app.spec2jira.io      │                │
│                   │   demo.spec2jira.io     │                │
└───────────────────┼─────────────────────────┼───────────────┘
                    │                         │
┌───────────────────▼─────────────────────────▼───────────────┐
│                    GKE CLUSTER (Multi-tenant)                │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Frontend  │  │ API      │  │ ML       │  │ Worker   │    │
│  │ (React)   │  │ Gateway  │  │ Inference│  │ Service  │    │
│  │ Nginx     │  │ (Spring) │  │ (FastAPI)│  │ (Kafka)  │    │
│  └─────┬─────┘  └─────┬────┘  └────┬─────┘  └────┬─────┘    │
│        │              │            │              │          │
│  ┌─────▼──────────────▼────────────▼──────────────▼─────┐   │
│  │              INTERNAL SERVICE MESH (Istio)            │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                         │                                    │
│  ┌──────────┐  ┌───────▼───┐  ┌──────────┐  ┌──────────┐  │
│  │ Keycloak │  │ PostgreSQL│  │  Redis    │  │  Kafka   │  │
│  │ (Auth)   │  │ (Cloud    │  │  (Cache)  │  │ (Events) │  │
│  │          │  │  SQL)     │  │           │  │          │  │
│  └──────────┘  └───────────┘  └──────────┘  └──────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         GPU Node Pool (L4) — ML Training/Inference    │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │   │
│  │  │ Phi-3 Text  │  │ Phi-3 Vision │  │ LoRA       │  │   │
│  │  │ Inference   │  │ Inference    │  │ Adapter    │  │   │
│  │  │ Server      │  │ Server       │  │ Registry   │  │   │
│  │  └─────────────┘  └──────────────┘  └────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow — Spec-to-Sprint Pipeline

```
Confluence Page (HTML/JSON)
       │
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ 1. Extraction│────▶│ 2. Parsing   │────▶│ 3. Section   │
│    Service   │     │    Engine    │     │    Classifier│
│ (REST/API)   │     │ (HTML→AST)  │     │ (ML)         │
└──────────────┘     └──────────────┘     └──────────────┘
                                                 │
       ┌─────────────────────────────────────────┘
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ 4. Entity    │────▶│ 5. Work Item │────▶│ 6. Review    │
│    Extraction│     │    Generator │     │    UI        │
│ (NER/Vision) │     │ (Phi-3+LoRA)│     │ (Human Loop) │
└──────────────┘     └──────────────┘     └──────────────┘
                                                 │
       ┌─────────────────────────────────────────┘
       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ 7. JIRA      │────▶│ 8. Audit     │────▶│ 9. Analytics │
│    Push      │     │    Trail     │     │    Dashboard │
│ (REST API)   │     │ (Immutable)  │     │ (Metrics)    │
└──────────────┘     └──────────────┘     └──────────────┘
```

### 2.3 Multi-Tenant Architecture

```
┌─────────────────────────────────────────┐
│            TENANT ISOLATION             │
│                                         │
│  Tenant A (Bank X)    Tenant B (Bank Y) │
│  ┌─────────────┐     ┌─────────────┐   │
│  │ Schema: a   │     │ Schema: b   │   │
│  │ LoRA: a.bin │     │ LoRA: b.bin │   │
│  │ Config: a   │     │ Config: b   │   │
│  │ Audit: a    │     │ Audit: b    │   │
│  └─────────────┘     └─────────────┘   │
│                                         │
│  Shared: Base Phi-3, Keycloak, Kafka    │
│  Isolated: Data, Models, Configs, Logs  │
└─────────────────────────────────────────┘
```

---

## 3. FUNCTIONAL REQUIREMENTS

### 3.1 User Management & Authentication (Module: AUTH)

**Описание:** Пълна система за управление на потребители, роли, организации и достъп. Интеграция с корпоративни identity providers чрез OIDC/SAML.

**Функционалности:**

**3.1.1 Регистрация и Onboarding:**
- Self-service регистрация с email verification (magic link + OTP fallback)
- Organization creation flow: company name, domain, size, industry
- Invite-based onboarding: admin изпраща покана по email, потребителят се присъединява
- First-time setup wizard: Atlassian connection, team structure, initial preferences
- Trial activation: автоматично активиране на 14-дневен безплатен триал при регистрация

**3.1.2 Role-Based Access Control (RBAC):**
- Роли: Super Admin, Org Admin, Project Manager, Team Lead, Developer, Viewer, Billing Admin
- Permissions matrix:
  - Super Admin: всичко + tenant management
  - Org Admin: user management, billing, project creation, settings
  - Project Manager: project settings, spec imports, work item approval
  - Team Lead: spec imports, review, JIRA push, team analytics
  - Developer: spec review, work item editing, JIRA view
  - Viewer: read-only достъп до dashboards и audit logs
  - Billing Admin: subscription management, invoices, payment methods
- Custom roles: възможност за създаване на custom roles с granular permissions
- Role inheritance: Team Lead наследява Developer permissions + добавя нови

**3.1.3 Organization & Team Management:**
- Multi-org support: един потребител може да принадлежи към няколко организации
- Team hierarchy: Organization → Department → Team → Members
- Team-level settings: default JIRA project, Confluence space, notification preferences
- Member management: add/remove/suspend members, bulk operations
- Activity log: кой кога е направил какво в организацията

**3.1.4 SSO & Enterprise Authentication:**
- Keycloak-based OIDC/SAML 2.0 integration
- LDAP/Active Directory connector за enterprise клиенти
- Supported IdPs: Azure AD, Okta, Google Workspace, OneLogin, PingFederate
- MFA enforcement: TOTP, WebAuthn/FIDO2, SMS (fallback)
- Session management: configurable session duration, concurrent session limits, forced logout
- IP whitelisting per organization (enterprise feature)

**3.1.5 API Authentication:**
- API key management: create/revoke/rotate API keys per user/service account
- OAuth 2.0 client credentials flow за service-to-service комуникация
- JWT token management: access + refresh tokens, configurable expiration
- Rate limiting per API key: configurable по plan tier
- Webhook authentication: HMAC-SHA256 signed payloads

**Acceptance Criteria:**
- AC1: Потребител може да се регистрира и да активира триал за под 2 минути
- AC2: Org Admin може да покани 50 потребителя с bulk CSV upload
- AC3: SSO login с Azure AD работи за под 3 секунди end-to-end
- AC4: RBAC enforcement е 100% — няма unauthorized access при penetration test
- AC5: API key rotation не прекъсва active sessions
- AC6: Audit log записва всяко authentication event с ISO 27001 compliant формат

**Технически бележки:**
- Keycloak deployment: dedicated pod в GKE, PostgreSQL backend, HA с 2 replicas minimum
- Password policy: min 12 chars, complexity rules, breach detection (HaveIBeenPwned API)
- Token storage: Redis с encryption at rest, 15min access / 7d refresh default
- GDPR: потребител може да изтрие акаунта си и всички свързани данни (right to erasure)

---

### 3.2 SaaS Subscription & Billing (Module: BILLING)

**Описание:** Система за управление на абонаменти, фактуриране и usage tracking. Три tier-а: Starter (€1,000–1,500/mo), Professional (€3,500–6,000/mo), Enterprise (€10,000–21,000/mo).

**Функционалности:**

**3.2.1 Subscription Management:**
- Plan tiers с feature gates:
  - Starter: 5 users, 10 specs/month, 1 JIRA project, email support, basic analytics
  - Professional: 25 users, 50 specs/month, 5 JIRA projects, priority support, advanced analytics, custom LoRA fine-tuning
  - Enterprise: unlimited users, unlimited specs, unlimited projects, dedicated CSM, SLA 99.9%, on-premise option, custom integrations, SSO/SAML
- Plan upgrade/downgrade flow с prorated billing
- Annual vs monthly billing (annual = 2 months free)
- Custom enterprise pricing: negotiated contracts, volume discounts
- Grandfathered pricing: existing customers keep their rate при price changes

**3.2.2 Usage Tracking & Metering:**
- Real-time usage dashboard: specs processed, API calls, storage used, active users
- Usage alerts: 80% и 90% thresholds с email/Slack notifications
- Overage handling: automatic overage billing at per-unit rate или hard cap (configurable)
- Usage history: 12-month rolling window с export to CSV/PDF
- Per-spec metering: complexity score (pages, diagrams, tables) → cost calculation

**3.2.3 Payment Processing:**
- Stripe integration: credit card, SEPA direct debit (EU), wire transfer (Enterprise)
- Invoice generation: automated monthly/annual invoices, PDF, EU VAT compliant
- Tax handling: VAT reverse charge за B2B EU, tax-exempt certificates
- Payment retry logic: 3 attempts over 7 days, grace period, dunning emails
- Refund handling: prorated refunds при downgrade/cancellation

**3.2.4 Billing Portal:**
- Self-service portal: update payment method, download invoices, view usage
- Billing history: all transactions, payments, credits, refunds
- Cost forecasting: projected cost based на current usage trend
- Budget alerts: configurable budget limit с notifications

**Acceptance Criteria:**
- AC1: Stripe checkout completes в под 10 секунди
- AC2: Usage metering е real-time с max 5 минути delay
- AC3: Invoice PDF е EU VAT compliant (с VAT number, reverse charge note)
- AC4: Dunning email sequence се изпраща коректно (day 1, 3, 7 — suspend на day 10)
- AC5: Plan change (upgrade/downgrade) се прилага незабавно с prorated adjustment
- AC6: GDPR compliant: billing data retention е 7 години (legal requirement), после автоматично изтриване

**Технически бележки:**
- Stripe API v2024: Payment Intents, Subscriptions, Invoicing, Customer Portal
- Usage events → Kafka topic `billing.usage` → aggregation → Stripe Usage Records
- Idempotency keys за всички Stripe API calls
- Webhook handling: Stripe → API Gateway → billing service (retry-safe, idempotent)
- Database: billing schema isolated от application schema за PCI DSS alignment

---

### 3.3 Confluence Extraction Pipeline (Module: EXTRACTION)

**Описание:** Извличане и парсване на съдържание от Confluence страници — текст, таблици, диаграми, UI mockups, embedded attachments. Поддръжка на различни documentation стилове на Business Analysts.

**Функционалности:**

**3.3.1 Confluence Connection:**
- OAuth 2.0 (3LO) интеграция с Atlassian Cloud
- API token support за Confluence Data Center/Server
- Connection test endpoint: валидира credentials и permissions
- Space browser: list spaces → pages → child pages (tree view)
- Batch import: select multiple pages за batch processing
- Webhook listener: автоматичен trigger при page update (Confluence webhook → Kafka event)

**3.3.2 Content Extraction Engine:**
- HTML → AST parsing: Confluence storage format (XHTML) → structured Abstract Syntax Tree
- Content type detection и extraction:
  - Headings (h1–h6): section hierarchy mapping
  - Paragraphs: plain text с inline formatting preservation
  - Tables: structured data extraction (headers, rows, merged cells)
  - Code blocks: language detection, code content extraction
  - Status macros: extract status labels (TODO, IN PROGRESS, DONE)
  - Info/Warning/Note panels: extract panel type + content
  - Expand macros: extract collapsed content
  - Table of Contents: use for section navigation
- Attachment handling:
  - Images (PNG, JPEG, SVG): download + store in Cloud Storage + pass to vision model
  - Diagrams (draw.io, Lucidchart, Mermaid): extract as image + attempt structured parsing
  - PDF attachments: extract text via OCR pipeline
  - Excel/CSV attachments: extract tabular data

**3.3.3 Section Classification (ML):**
- Classify каждую секцию по тип:
  - Requirements (functional, non-functional)
  - User stories (As a... I want... So that...)
  - Acceptance criteria
  - Technical specifications
  - Architecture decisions
  - UI/UX descriptions
  - Data models
  - API specifications
  - Business rules
  - Constraints & assumptions
  - Dependencies
  - Out of scope
- Confidence score per classification (0.0–1.0)
- Human override: потребителят може да re-classify секция

**3.3.4 Entity Extraction (NER):**
- Extract named entities:
  - System components (e.g., "Payment Gateway", "User Service")
  - Roles/Actors (e.g., "Admin", "End User", "System")
  - Data entities (e.g., "Transaction", "Account", "Customer")
  - External systems (e.g., "SAP", "Core Banking", "SWIFT")
  - API endpoints (e.g., "POST /api/v1/payments")
  - Priority indicators (e.g., "must have", "critical", "nice to have")
  - Estimate hints (e.g., "complex", "2 sprints", "T-shirt size L")
- Entity linking: свързване на entities между секциите (e.g., "Payment Gateway" в секция 3 = "Payment Gateway" в секция 7)
- Entity graph: визуализация на relationships между entities

**3.3.5 Multimodal Processing (Vision):**
- Phi-3-vision-128k-instruct за обработка на:
  - Architecture diagrams → extract components, connections, data flows
  - UI mockups/wireframes → extract screens, elements, user interactions
  - Flowcharts → extract steps, decisions, paths
  - ER diagrams → extract entities, relationships, attributes
  - Sequence diagrams → extract actors, messages, order
- Output: structured JSON с extracted elements + bounding boxes
- Confidence threshold: 0.7 minimum за автоматично включване, 0.5–0.7 → human review

**Acceptance Criteria:**
- AC1: Extraction на 50-page Confluence spec завършва за под 60 секунди
- AC2: Table extraction accuracy ≥ 95% (включително merged cells)
- AC3: Section classification accuracy ≥ 85% на banking domain specs
- AC4: Image/diagram extraction: ≥ 80% на architecture diagrams
- AC5: Concurrent extraction на 10 specs не деградира performance повече от 20%
- AC6: Webhook trigger обработва page update за под 30 секунди

**Технически бележки:**
- Confluence REST API v2 (Cloud) / v1 (Data Center)
- HTML parsing: Jsoup (Java) за initial extraction, custom AST builder
- Image processing pipeline: download → resize → normalize → Phi-3-vision inference
- Kafka topics: `extraction.requested`, `extraction.completed`, `extraction.failed`
- Retry policy: 3 retries с exponential backoff (1s, 5s, 30s)
- Rate limiting: respect Atlassian API rate limits (per-user, per-app)

---

### 3.4 ML Inference & Work Item Generation (Module: ML-ENGINE)

**Описание:** Core ML pipeline — приема extracted и classified content, генерира structured JIRA work items чрез fine-tuned Phi-3 + LoRA. Включва prompt engineering, output parsing, quality validation и feedback loop.

**Функционалности:**

**3.4.1 Model Serving Infrastructure:**
- FastAPI inference server с GPU support (NVIDIA L4)
- Model registry: versioned model storage в Cloud Storage
  - Base: Phi-3-mini-128k-instruct (3.8B params)
  - Vision: Phi-3-vision-128k-instruct
  - LoRA adapters: per-customer fine-tuned adapters (stored separately)
- Dynamic LoRA loading: load customer-specific adapter at inference time без model restart
- Batch inference: process multiple sections в single GPU batch за efficiency
- Model A/B testing: route % of traffic към new model version за comparison
- Fallback chain: primary model → fallback model → rule-based generator

**3.4.2 Prompt Engineering & Template System:**
- Structured prompt templates per work item type:
  - Epic generation: from high-level feature descriptions
  - Story generation: from requirements + acceptance criteria sections
  - Task generation: from technical specifications
  - Bug template: from known issues / defect descriptions
  - Sub-task decomposition: from complex stories
- Template variables:
  - `{section_content}` — extracted text
  - `{section_type}` — classified type
  - `{entities}` — extracted named entities
  - `{project_context}` — project-level context (domain, team, conventions)
  - `{customer_conventions}` — customer-specific naming, labels, workflows
- Dynamic context window management: prioritize most relevant content within 128K token limit
- Few-shot examples: include 2–3 examples from customer's existing JIRA data

**3.4.3 Output Schema — Generated Work Items:**

```json
{
  "work_items": [
    {
      "type": "Story|Task|Bug|Sub-task|Epic",
      "summary": "Кратко описание (max 120 chars)",
      "description": "Детайлно описание в JIRA markdown",
      "acceptance_criteria": [
        "AC1: ...",
        "AC2: ..."
      ],
      "story_points": 3,
      "priority": "Critical|High|Medium|Low",
      "labels": ["backend", "auth", "mvp"],
      "components": ["API Gateway", "Auth Service"],
      "assignee_role": "Backend Developer",
      "sprint_suggestion": "Sprint 1",
      "dependencies": ["S2J-42", "S2J-43"],
      "source_section": {
        "page_id": "12345",
        "page_title": "Auth Specification",
        "section_heading": "3.1.2 RBAC",
        "paragraph_range": "15-28",
        "confidence": 0.92
      },
      "estimated_effort": {
        "t_shirt": "M",
        "hours_range": "8-16",
        "complexity": "medium"
      },
      "definition_of_done": [
        "Code reviewed and approved",
        "Unit tests passing (≥80% coverage)",
        "Integration tests passing",
        "Documentation updated",
        "Deployed to staging"
      ]
    }
  ],
  "metadata": {
    "total_items": 47,
    "by_type": { "Epic": 1, "Story": 18, "Task": 22, "Sub-task": 6 },
    "confidence_distribution": { "high": 32, "medium": 12, "low": 3 },
    "generation_time_ms": 4200,
    "model_version": "phi3-s2j-v1.2-lora-banking",
    "tokens_used": { "input": 45000, "output": 12000 }
  }
}
```

**3.4.4 Quality Validation Pipeline:**
- Schema validation: всеки generated item трябва да match output schema
- Duplicate detection: cosine similarity check между generated items (threshold 0.85)
- Completeness check: всяка source section трябва да има поне 1 generated item
- Consistency check: dependencies reference real items, components exist в JIRA
- Banking domain validation: check за compliance-related keywords → auto-tag
- Hallucination detection: verify generated content traces back to source section
- Quality score: composite score (0–100) per work item

**3.4.5 Feedback & Fine-tuning Loop:**
- Human review feedback capture: accept / edit / reject per work item
- Feedback storage: `(input, generated_output, human_corrected_output, action)` tuples
- Periodic fine-tuning trigger: when feedback dataset reaches N examples
- A/B comparison: old model vs newly fine-tuned model on held-out test set
- Customer-specific adapter update: incremental LoRA fine-tuning per customer
- Model performance tracking: accuracy, acceptance rate, edit distance over time

**Acceptance Criteria:**
- AC1: Inference latency ≤ 5 секунди per section (average), ≤ 15 секунди (p99)
- AC2: Generated work items pass schema validation в 100% от случаите
- AC3: Duplicate detection catch rate ≥ 90%
- AC4: Human acceptance rate ≥ 70% без edit (target: 85% след 3 месеца fine-tuning)
- AC5: LoRA adapter switch ≤ 500ms (no model reload needed)
- AC6: Batch inference на 50 sections ≤ 45 секунди
- AC7: Fallback chain activates автоматично при primary model failure

**Технически бележки:**
- GPU: NVIDIA L4 (24GB VRAM), 1 GPU per inference pod, auto-scaling 1–4 pods
- Model loading: PEFT library за LoRA, bitsandbytes за 4-bit quantization
- Inference framework: vLLM или TGI (Text Generation Inference) за production throughput
- Prompt caching: identical prompts → cache response в Redis (TTL 1h)
- Monitoring: GPU utilization, inference latency, queue depth, error rate

---

### 3.5 Review UI & Human-in-the-Loop (Module: REVIEW-UI)

**Описание:** Уеб интерфейс за review и approval на AI-generated work items. Ключов диференциатор — дава на потребителя пълен контрол преди push към JIRA.

**Функционалности:**

**3.5.1 Review Dashboard:**
- Spec import queue: list на pending, in-review, approved, pushed specs
- Per-spec summary card: title, page count, generated items count, overall confidence, reviewer(s)
- Status filters: All, Pending Review, In Review, Approved, Pushed to JIRA, Rejected
- Sort/search: by date, confidence, reviewer, project

**3.5.2 Work Item Review Interface:**
- Split-pane view: source spec (left) ↔ generated work items (right)
- Source highlighting: click на work item → highlights source section в spec
- Per-item actions:
  - ✅ Accept: approve as-is
  - ✏️ Edit: inline editing на summary, description, acceptance criteria, story points, etc.
  - ❌ Reject: remove item с reason (hallucination, duplicate, wrong type, etc.)
  - 🔀 Split: разделяне на един item на 2+ items
  - 🔗 Merge: обединяване на 2+ items в един
  - 📎 Re-assign: промяна на type (Story → Task), labels, components
- Bulk actions: accept all high-confidence items, reject all low-confidence
- Confidence indicator: color-coded (green ≥0.85, yellow 0.70–0.84, red <0.70)
- Diff view при edit: показва original vs edited version

**3.5.3 Collaboration Features:**
- Multi-reviewer support: assign multiple reviewers per spec
- Comments/notes per work item (internal, not pushed to JIRA)
- Review status tracking: who reviewed what, when
- @mention notifications: tag колеги за input на specific items
- Review history: full audit trail на всеки review action

**3.5.4 Source Traceability Panel:**
- Clickable source reference: от всеки work item → директен link към Confluence page + section
- Visual mapping: hover на source → highlight в generated items (и обратно)
- Traceability report: exportable matrix — source section ↔ generated work items
- Gap analysis: sections без generated items се маркират с warning
- Coverage indicator: % на source content, покрит от generated items

**Acceptance Criteria:**
- AC1: Review UI зарежда spec с 50 work items за под 2 секунди
- AC2: Split-pane view работи responsive (desktop + tablet)
- AC3: Inline edit запазва промени без page reload (optimistic update)
- AC4: Bulk accept/reject на 50 items завършва за под 1 секунда
- AC5: Source traceability highlight е pixel-accurate (±5px)
- AC6: Review audit trail записва всяко действие с timestamp и user

---

### 3.6 JIRA Integration & Push (Module: JIRA-SYNC)

**Описание:** Двупосочна интеграция с JIRA за push на approved work items и sync на статуси обратно.

**Функционалности:**

**3.6.1 JIRA Connection Setup:**
- OAuth 2.0 (3LO) за JIRA Cloud
- API token за JIRA Data Center/Server
- Project selector: list достъпни JIRA projects
- Board mapping: map Spec2JIRA teams → JIRA boards
- Field mapping: map generated fields → JIRA custom fields
- Issue type mapping: Story → Story, Task → Task (configurable)
- Workflow mapping: map generated status → JIRA workflow transitions

**3.6.2 Push to JIRA:**
- Single item push: push individual approved work item
- Batch push: push all approved items from a spec
- Push preview: dry-run showing exactly what will be created в JIRA
- Dependency handling: push items in correct order (dependencies first)
- Sprint assignment: optionally assign items to active/future sprint
- Component auto-create: if component doesn't exist in JIRA → create it
- Label sync: create missing labels automatically
- Link creation: create JIRA issue links for dependencies (blocks/is-blocked-by)
- Confluence link: add link back to source Confluence page on каждый JIRA issue

**3.6.3 Automated JIRA Actions:**
- Create Branch: от JIRA task → trigger Bitbucket/GitHub branch creation
  - Branch naming convention: `feature/S2J-{id}-{summary-slug}`
  - Auto-link branch to JIRA issue
  - Support: Bitbucket Cloud, Bitbucket Server, GitHub, GitLab
- Create Pull Request template: pre-filled PR description from JIRA issue
- Transition triggers: when PR merged → auto-move JIRA issue to "Done"
- Sprint automation: auto-assign items to next sprint based on capacity
- Sub-task auto-generation: option to auto-create standard sub-tasks (Code Review, Testing, Documentation)

**3.6.4 Bi-directional Sync:**
- JIRA → Spec2JIRA: status changes, assignee changes, story point updates
- Sync frequency: webhook-based (real-time) + periodic poll (fallback, every 5 min)
- Conflict resolution: JIRA is source of truth за runtime changes
- Sync status dashboard: показва sync health, last sync time, conflicts

**Acceptance Criteria:**
- AC1: Push на 50 work items към JIRA завършва за под 30 секунди
- AC2: Dependencies се създават коректно (parent before child)
- AC3: Branch creation в Bitbucket отнема под 5 секунди от JIRA trigger
- AC4: Bi-directional sync отразява JIRA промени в Spec2JIRA за под 2 минути
- AC5: Push preview показва 100% accurate preview на what will be created
- AC6: Rollback: може да се изтрият всички pushed items от JIRA с един click

---

### 3.7 Audit Trail & Compliance (Module: AUDIT)

**Описание:** Immutable audit log система за пълна проследимост на всяко действие. Критичен за banking compliance (SOX, DORA, EU AI Act).

**Функционалности:**

**3.7.1 Audit Event Capture:**
- Всяко действие генерира audit event:
  - Authentication events: login, logout, failed login, MFA challenge
  - Data events: spec import, work item generation, review action, JIRA push
  - Admin events: user create/modify/delete, role change, settings change
  - Billing events: subscription change, payment, invoice generation
  - System events: model version change, deployment, configuration update
- Event schema: `{timestamp, actor, action, resource, resource_id, before_state, after_state, ip_address, user_agent, session_id, tenant_id}`
- Immutability: append-only log, no update/delete operations
- Tamper detection: hash chain (each event includes hash of previous event)

**3.7.2 Audit Dashboard & Search:**
- Full-text search across audit events
- Filters: date range, actor, action type, resource type, tenant
- Timeline view: chronological visualization на events
- Export: CSV, JSON, PDF report format
- Compliance reports: pre-built reports за SOX, DORA, ISO 27001

**3.7.3 AI Decision Traceability:**
- Per work item: full chain от source section → classification → entity extraction → prompt → model output → human review → JIRA issue
- Model version tracking: which model version generated which items
- Confidence score history: track how confidence changed с human feedback
- Explainability: why did the model generate this specific output (attention weights, source mapping)

**Acceptance Criteria:**
- AC1: Audit events се записват с max 100ms latency
- AC2: Hash chain integrity check може да се валидира за под 10 секунди (1M events)
- AC3: Search across 10M audit events връща резултати за под 2 секунди
- AC4: Compliance report generation (PDF) за 1 месец данни ≤ 30 секунди
- AC5: No audit event е ever lost (guaranteed delivery via Kafka + PostgreSQL)
- AC6: GDPR: tenant audit data може да се анонимизира при request

---

### 3.8 Analytics & Reporting (Module: ANALYTICS)

**Описание:** Dashboards и reports за ROI tracking, usage analytics и product insights.

**Функционалности:**

**3.8.1 Usage Analytics Dashboard:**
- Specs processed: daily/weekly/monthly с trend graph
- Work items generated: total, by type, by confidence level
- Time saved calculation: estimated hours saved vs manual breakdown
  - Formula: `(avg_manual_hours_per_spec × specs_processed) - (avg_review_hours × specs_processed)`
  - Default benchmark: 4h manual vs 0.5h review = 3.5h saved per spec
- Acceptance rate: % items accepted without edit, with edit, rejected
- Top reviewers: leaderboard по review throughput и quality

**3.8.2 Quality Metrics:**
- Model accuracy trend: acceptance rate over time (daily/weekly)
- Edit distance: average amount of editing per item (lower = better)
- Confidence calibration: actual acceptance rate vs predicted confidence
- Spec complexity distribution: histogram на spec sizes и complexity scores
- Error categorization: why items get rejected (pie chart)

**3.8.3 ROI Report (Exportable):**
- Executive summary: total hours saved, cost savings (at configured hourly rate)
- Detailed breakdown: per team, per project, per spec
- Trend analysis: month-over-month improvement
- Comparison: before Spec2JIRA vs after (if baseline data available)
- Export formats: PDF, PowerPoint, CSV

**Acceptance Criteria:**
- AC1: Dashboard зарежда за под 3 секунди с 6 месеца данни
- AC2: ROI report generation (PDF) ≤ 15 секунди
- AC3: Real-time update на metrics (max 5 min delay)
- AC4: Custom date range filtering работи за всички charts

---

## 4. NON-FUNCTIONAL REQUIREMENTS

### 4.1 Infrastructure & Cloud Environment (Module: INFRA)

**4.1.1 GCP Project Structure:**
- Project hierarchy:
  - `spec2jira-prod` — production environment
  - `spec2jira-staging` — staging/pre-prod
  - `spec2jira-dev` — development
  - `spec2jira-demo` — demo/trial environment (isolated)
  - `spec2jira-ml-training` — GPU instances за model training (separate billing)
- VPC Network: custom VPC с private subnets, Cloud NAT за egress
- Region strategy: primary `europe-west1` (Belgium), DR `europe-west3` (Frankfurt)

**4.1.2 GKE Cluster Configuration:**
- Production cluster:
  - Node pools: `general` (e2-standard-4, 3–10 nodes, autoscaling), `gpu` (g2-standard-8 + L4, 1–4 nodes), `system` (e2-standard-2, 2 nodes)
  - Namespaces: `app`, `ml`, `monitoring`, `auth`, `demo`
  - Network policy: namespace-level isolation
  - Pod security: restricted PSS (Pod Security Standards)
- Workload Identity: GKE pods → GCP IAM за secure secret-free access
- Backup: Velero за cluster state backup, daily snapshots

**4.1.3 Database Infrastructure:**
- Cloud SQL for PostgreSQL 16:
  - HA configuration: regional with automatic failover
  - Specs: db-custom-4-16384 (4 vCPU, 16GB RAM)
  - Storage: SSD, auto-resize, начални 100GB
  - Maintenance window: Sunday 03:00–04:00 CET
  - Backup: automated daily, 30 day retention, point-in-time recovery
  - Read replicas: 1 replica за analytics queries
- Redis (Memorystore):
  - Standard tier, 5GB, HA with replica
  - Use: session cache, inference cache, rate limiting counters

**4.1.4 Storage:**
- Cloud Storage buckets:
  - `spec2jira-models` — ML model artifacts (versioned, lifecycle: keep 5 versions)
  - `spec2jira-uploads` — user uploaded content (lifecycle: 90 days после deletion)
  - `spec2jira-exports` — generated reports, exports (lifecycle: 30 days)
  - `spec2jira-audit` — audit log archives (lifecycle: 7 years, Coldline после 1 year)
  - `spec2jira-backups` — database backups (lifecycle: 30 days)
- Encryption: Google-managed keys (default), CMEK option за Enterprise tier

**4.1.5 Demo/Trial Infrastructure:**
- Dedicated `spec2jira-demo` GCP project
- Shared GKE cluster с resource quotas per trial tenant
- Pre-loaded demo data: sample Confluence specs (banking domain)
- Sandbox JIRA instance: Atlassian sandbox за demo pushes
- Auto-cleanup: trial data purged 14 days след trial expiry
- Rate limiting: 10 specs max, 5 users max, no custom fine-tuning
- Demo endpoint: `demo.spec2jira.io` с branded landing page
- Isolated от production: отделна database, отделен Keycloak realm

**4.1.6 Networking & DNS:**
- Domain: `spec2jira.io` (primary), `spec2jira.com` (redirect)
- Subdomains: `app.spec2jira.io`, `api.spec2jira.io`, `demo.spec2jira.io`, `auth.spec2jira.io`, `docs.spec2jira.io`
- SSL: Google-managed certificates via Certificate Manager
- CDN: Cloud CDN за static assets (frontend build)
- DDoS protection: Cloud Armor (standard tier)
- DNS: Cloud DNS с DNSSEC enabled

### 4.2 CI/CD & DevOps Pipeline (Module: DEVOPS)

**4.2.1 Source Code Management:**
- GitHub organization: `spec2jira`
- Repositories:
  - `spec2jira-frontend` — React app
  - `spec2jira-api` — Spring Boot API
  - `spec2jira-ml` — ML inference service
  - `spec2jira-worker` — Kafka consumer workers
  - `spec2jira-infra` — Terraform + Helm charts
  - `spec2jira-docs` — documentation (Docusaurus)
- Branch strategy: trunk-based development
  - `main` — production-ready
  - `feature/*` — short-lived feature branches (max 3 days)
  - `hotfix/*` — urgent production fixes
  - `release/*` — release candidates (optional, per sprint)
- Branch protection: require PR review, CI pass, no force push to main

**4.2.2 CI Pipeline (GitHub Actions):**
- On PR:
  - Lint: ESLint (frontend), Checkstyle (API), Black+Ruff (ML)
  - Unit tests: Jest (frontend), JUnit 5 (API), pytest (ML)
  - Integration tests: Testcontainers (PostgreSQL, Redis, Kafka)
  - Security scan: Snyk (dependencies), Trivy (container images)
  - Code coverage: minimum 80% enforcement
  - Build: Docker image build + push to Artifact Registry (tagged: `pr-{number}`)
- On merge to main:
  - All above + E2E tests (Playwright)
  - Docker image: tagged `latest` + `sha-{commit}`
  - Helm chart update: bump version в Chart.yaml
  - Auto-deploy to staging

**4.2.3 CD Pipeline (ArgoCD):**
- GitOps: ArgoCD watches `spec2jira-infra` repo за Helm chart changes
- Environments:
  - `dev` — auto-deploy on every commit
  - `staging` — auto-deploy on merge to main
  - `prod` — manual approval + canary deployment (10% → 50% → 100%)
  - `demo` — manual deploy, per-release
- Rollback: one-click rollback to previous version
- Deployment notifications: Slack channel `#deployments`

**4.2.4 Infrastructure as Code:**
- Terraform modules:
  - `gke-cluster` — GKE cluster + node pools
  - `cloud-sql` — PostgreSQL instance + replicas
  - `networking` — VPC, subnets, firewall rules, Cloud NAT
  - `iam` — service accounts, IAM bindings
  - `storage` — Cloud Storage buckets
  - `monitoring` — Prometheus, Grafana, alerting
  - `dns` — Cloud DNS zones + records
  - `demo` — demo environment (separate module)
- State: remote state в Cloud Storage с locking
- Plan review: Terraform plan output в PR comments
- Apply: manual apply за prod, auto-apply за dev/staging

### 4.3 Monitoring, Alerting & Observability (Module: MONITORING)

**4.3.1 Metrics (Prometheus + Grafana):**
- Application metrics:
  - Request rate, error rate, latency (RED method) per service
  - Active users, concurrent sessions
  - Spec processing queue depth
  - Work item generation throughput
- ML metrics:
  - GPU utilization, memory usage, temperature
  - Inference latency (p50, p95, p99)
  - Model cache hit rate
  - Queue wait time
- Infrastructure metrics:
  - Pod CPU/memory usage
  - Node disk I/O, network throughput
  - Database connections, query latency, replication lag
  - Kafka consumer lag, partition distribution

**4.3.2 Logging (ELK Stack):**
- Structured JSON logging (all services)
- Log levels: ERROR, WARN, INFO, DEBUG (configurable per service)
- Centralized в Elasticsearch via Fluentbit DaemonSet
- Kibana dashboards: per-service, error tracking, slow queries
- Log retention: 30 days hot, 90 days warm, 1 year cold (Cloud Storage archive)

**4.3.3 Alerting:**
- PagerDuty integration за P1/P2 alerts
- Slack integration за P3/P4 alerts
- Alert rules:
  - P1 (Critical, 5min response): service down, data loss risk, security breach
  - P2 (High, 30min response): degraded performance, high error rate (>5%), GPU failure
  - P3 (Medium, 4h response): elevated latency, disk space >80%, certificate expiry <30d
  - P4 (Low, next business day): dependency deprecation, non-critical test failures

**4.3.4 Distributed Tracing:**
- OpenTelemetry SDK integration (all services)
- Trace propagation: HTTP headers (W3C TraceContext)
- Trace storage: Jaeger или Google Cloud Trace
- End-to-end trace: from Confluence extraction → ML inference → JIRA push

### 4.4 Security (Module: SECURITY)

**4.4.1 Application Security:**
- OWASP Top 10 compliance
- Input validation: all endpoints, server-side
- Output encoding: XSS prevention
- SQL injection prevention: parameterized queries only
- CSRF protection: SameSite cookies + CSRF tokens
- Content Security Policy (CSP) headers
- Rate limiting: per-IP, per-user, per-API-key
- Dependency scanning: automated Snyk/Dependabot alerts

**4.4.2 Data Security:**
- Encryption at rest: AES-256 (Cloud SQL, Cloud Storage, Redis)
- Encryption in transit: TLS 1.3 (all inter-service и external)
- PII handling: identify and mask PII в logs и audit trails
- Data classification: Public, Internal, Confidential, Restricted
- Key management: Google Cloud KMS, automatic rotation

**4.4.3 Compliance Preparation:**
- SOC 2 Type I readiness: policies, access controls, monitoring
- ISO 27001 alignment: information security controls
- GDPR: data processing agreement template, DPO designation
- Penetration testing: annual (third-party), quarterly automated scans
- Vulnerability disclosure program: responsible disclosure policy page

---

## 5. BRAND & MARKETING INFRASTRUCTURE

### 5.1 Website & Brand Hosting

**5.1.1 Marketing Website:**
- Domain: `spec2jira.io`
- Stack: Next.js 14 + Tailwind CSS, deployed on Vercel или Cloud Run
- Pages: Home, Product, Pricing, Docs, Blog, About, Contact, Demo Request
- SEO: structured data, sitemap, robots.txt, Open Graph tags
- Analytics: Google Analytics 4, Hotjar (heatmaps), Mixpanel (product analytics)
- Blog: MDX-based, categories: Product Updates, Engineering, Banking AI, Case Studies

**5.1.2 Documentation Site:**
- `docs.spec2jira.io`
- Stack: Docusaurus 3, deployed alongside marketing site
- Sections: Getting Started, User Guide, API Reference, Admin Guide, Security, FAQ
- Search: Algolia DocSearch
- Versioned docs: per-release version

**5.1.3 Brand Assets:**
- Logo: primary, icon-only, dark/light variants
- Color palette: primary (brand blue), secondary, accent, semantic colors
- Typography: Inter (UI), JetBrains Mono (code)
- Brand guidelines document

---

## 6. DEVELOPMENT METHODOLOGY

### 6.1 Agile Process

- Sprints: 2-week sprints
- Ceremonies: Sprint Planning (Monday), Daily Standup (async), Sprint Review + Retro (Friday)
- Board: Kanban with WIP limits
  - Columns: Backlog → Refinement → Ready → In Progress (WIP: 3) → Code Review (WIP: 2) → Testing → Done
- Definition of Ready: описание, AC, design (ако е UI), dependencies identified
- Definition of Done: code reviewed, tests passing, deployed to staging, docs updated
- Estimation: story points (Fibonacci: 1, 2, 3, 5, 8, 13)

### 6.2 Quality Gates

- Code review: minimum 1 approver
- Test coverage: ≥80% (unit + integration)
- Performance: no regression beyond 10% на key metrics
- Security: no high/critical vulnerabilities
- Accessibility: WCAG 2.1 AA compliance (frontend)
- Documentation: API docs updated за всяко endpoint change

---

## 7. DEPENDENCIES & CONSTRAINTS

### 7.1 External Dependencies:
- Atlassian API (Confluence + JIRA): availability и rate limits
- Stripe API: payment processing
- GCP services: GKE, Cloud SQL, Cloud Storage, etc.
- Keycloak: authentication
- NVIDIA drivers: GPU compatibility за ML inference
- Bitbucket/GitHub APIs: branch creation automation

### 7.2 Constraints:
- Budget: bootstrapped, minimal cloud spend (target: <€2,000/month за prod+staging+demo)
- Team: initially 1 person (founder) → target 2–3 за MVP
- Timeline: 6 months to MVP launch
- GPU: L4 (24GB VRAM) — model must fit in single GPU
- Compliance: must pass basic security review от first banking customer

### 7.3 Assumptions:
- Atlassian ще поддържа текущото ниво на API достъп
- GCP L4 instances ще са достъпни в europe-west1
- Phi-3 модел license позволява commercial use
- Клиентите имат existing Confluence + JIRA setup

---

## 8. RELEASE PLAN

### Phase 1 — Foundation (Sprints 1–4, Weeks 1–8):
- GCP infrastructure setup (Terraform)
- Keycloak deployment + basic auth
- Database schema + migrations
- CI/CD pipeline (GitHub Actions + ArgoCD)
- Frontend skeleton (React + routing + auth)
- API Gateway skeleton (Spring Boot + security)

### Phase 2 — Core ML Pipeline (Sprints 5–8, Weeks 9–16):
- Confluence extraction engine
- Section classification model
- Entity extraction
- Phi-3 inference server
- Work item generation
- Output validation pipeline

### Phase 3 — Product Features (Sprints 9–11, Weeks 17–22):
- Review UI (split-pane, actions, collaboration)
- JIRA push integration
- Audit trail system
- Analytics dashboard
- Billing integration (Stripe)

### Phase 4 — Polish & Launch (Sprint 12–13, Weeks 23–26):
- Demo/trial infrastructure
- Marketing website
- Documentation site
- Security hardening
- Performance optimization
- Beta testing с 2–3 design partners
- Atlassian Marketplace listing preparation

---

**END OF SPECIFICATION**

**Document metadata:**
- Author: Alex Nikolov, Founder & CTO
- Last updated: March 2026
- Version: 1.0
- Classification: Confidential
- Total sections: 8 major, 35+ sub-sections
- Estimated total work items: 150–250
- Estimated effort: 6 months, 2–3 engineers
