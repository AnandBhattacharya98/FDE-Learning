# Teacher mode

A dashboard at `/teach` for the people who run the course. A **Teach** button appears in the
top bar for teachers only.

## Who can open it

Checked on the server for every request, like God mode:

1. The person signed in **with Google** (a password log-in is refused).
2. Their email is in `TEACHER_EMAILS` on Render, **or** the admin added it in God mode's
   **Teachers** panel, **or** they are the admin (`ADMIN_EMAILS`).

Everyone else gets a plain 404. Teachers still need an address that passes `ALLOWED_EMAIL_DOMAINS`.
Teachers can't add other teachers; only the admin can.

## Setup

| Env var (Render) | Needed? | What it does |
| --- | --- | --- |
| `TEACHER_EMAILS` | optional | Comma-separated teacher emails. You can use God mode's Teachers panel instead. |
| `ANTHROPIC_API_KEY` | for quiz generation | Already used by the coach and the grader. Without it, teachers write quizzes by hand. |
| `QUIZ_MODEL` | optional | Claude model that writes quizzes. Default `claude-opus-5-5`. |
| `MATERIAL_MAX_MB` | optional | Largest upload. Default 25. |

New tables (`fde_teachers`, `fde_materials`, `fde_material_files`, `fde_teacher_quizzes`,
`fde_teacher_quiz_attempts`, `fde_grade_reviews`, `fde_announcements`) are created on start-up.

## What's in it

- **Overview**: what needs you (projects to review, quiz drafts, unpublished materials, stuck
  learners) and the latest questions learners asked the coach.
- **Materials**: upload slides (PDF, PPTX), documents, images or short videos per week and module,
  or add a link. YouTube, Loom, Vimeo, Google Drive and Google Slides links play inside the course.
  Drafts stay hidden until published. Learners see published ones under **From your teachers** on
  the week page.
- **Quizzes**: pick materials (and/or the week's lessons), a number of questions, difficulty and a
  focus. Claude writes them in about a minute; edit any question, option, correct answer or
  explanation, then publish. Results show each learner's best score and how often each question
  was answered right. These quizzes are extra practice and don't change course progress.
- **Submissions**: every GitHub link learners saved, with the auto-grader's result
  (see `project-grading.md`). Check the repo on GitHub, regrade, then approve the score, set your
  own, or ask for changes. Your feedback appears on the learner's grade card; an override replaces
  the score in the cohort view.
- **Cohort**: the same learner list and stats drawer as God mode.
- **Announcements**: posts shown at the top of every learner's home page (pinned ones first).

## Where files are kept

Uploads are stored in the database (Neon) in their own table, and served through signed links
that expire after 6 hours. Neon's free plan holds 0.5 GB, so keep big videos on YouTube (unlisted),
Loom, Vimeo or Drive and add them as links. If uploads outgrow the database, move
`fde_material_files` to object storage (S3 or Cloudflare R2); nothing else needs to change.

Text for quizzes is read from PDF and PPTX files (including speaker notes) and plain-text files.
Videos can't be read, so paste a transcript or notes into the material.

## API

All under `/api/fde`, teacher-only unless noted:

- `GET /teacher/overview`, `GET /teacher/learners`, `GET /teacher/learners/{id}`, `GET /teacher/voice-scorecards`
- `GET|POST /teacher/materials`, `PATCH|DELETE /teacher/materials/{id}`; `GET /materials/{id}/file?exp&sig` (signed link, no login)
- `POST /teacher/quizzes/generate`, `GET|POST /teacher/quizzes`, `PUT|DELETE /teacher/quizzes/{id}`,
  `POST /teacher/quizzes/{id}/publish`, `GET /teacher/quizzes/{id}/results`
- `GET /teacher/submissions`, `GET /teacher/submissions/runs/{run_id}`, `POST /teacher/submissions/{user_id}/{project}/grade`,
  `PUT|DELETE /teacher/submissions/runs/{run_id}/review`, `GET /teacher/repo-check?url=`
- `POST /teacher/announcements`, `PATCH|DELETE /teacher/announcements/{id}`
- Learners: `GET /weeks/{id}/class`, `POST /class-quizzes/{id}/attempt`, `GET /announcements`
- Admin: `GET|POST /admin/teachers`, `DELETE /admin/teachers/{id}`
