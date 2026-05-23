import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type WikiPage = {
  pageid: number
  title: string
  extract: string
  fullurl?: string
  thumbnail?: { source: string }
  lang: string
}

type Mode = 'story' | 'timeline' | 'quiz' | 'cards'

type TimelineItem = {
  year: string
  text: string
}

type QuizQuestion = {
  question: string
  options: string[]
  answer: string
}

const EXAMPLES = [
  'https://en.wikipedia.org/wiki/Napoleon',
  'https://he.wikipedia.org/wiki/דוד_בן-גוריון',
  'https://en.wikipedia.org/wiki/Artificial_intelligence',
]

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'from', 'this', 'were', 'was', 'are', 'his', 'her', 'its', 'into', 'also',
  'של', 'את', 'על', 'עם', 'הוא', 'היא', 'היו', 'היה', 'גם', 'או', 'לא', 'זה', 'זו', 'כי', 'אשר', 'בין', 'ידי',
])

function parseWikiInput(input: string) {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('תכניס קישור או שם ערך')

  try {
    const url = new URL(trimmed)
    const hostParts = url.hostname.split('.')
    const lang = hostParts[0] || 'en'
    const pathParts = url.pathname.split('/wiki/')
    if (!pathParts[1]) throw new Error('זה לא נראה כמו קישור ויקיפדיה')
    return { lang, title: decodeURIComponent(pathParts[1]).replaceAll('_', ' ') }
  } catch {
    return { lang: /[א-ת]/.test(trimmed) ? 'he' : 'en', title: trimmed }
  }
}

function cleanText(text: string) {
  return text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\[[^\]]+\]/g, '')
    .trim()
}

function sentences(text: string) {
  return cleanText(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 55 && !s.startsWith('=='))
}

function paragraphs(text: string) {
  return cleanText(text)
    .split(/\n\n+/)
    .map((p) => p.trim().replace(/^=+|=+$/g, '').trim())
    .filter((p) => p.length > 90 && !p.toLowerCase().includes('references'))
}

function extractKeywords(text: string) {
  const words = cleanText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w))
  const freq = new Map<string, number>()
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1)
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w)
}

function buildTimeline(text: string): TimelineItem[] {
  const seen = new Set<string>()
  return sentences(text)
    .flatMap((sentence) => {
      const years = sentence.match(/\b(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})\b/g) || []
      return years.slice(0, 2).map((year) => ({ year, text: sentence }))
    })
    .filter((item) => {
      const key = `${item.year}-${item.text.slice(0, 80)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => Number(a.year) - Number(b.year))
    .slice(0, 8)
}

function buildQuiz(page: WikiPage): QuizQuestion[] {
  const facts = sentences(page.extract).slice(0, 12)
  const keywords = extractKeywords(page.extract)
  const optionsBase = [page.title, ...keywords].filter(Boolean)

  return facts.slice(0, 5).map((_, index) => {
    const answer = index === 0 ? page.title : (keywords[index] || page.title)
    const distractors = optionsBase.filter((x) => x !== answer).slice(index, index + 3)
    const options = [...new Set([answer, ...distractors])].slice(0, 4)
    while (options.length < 4) options.push(['תהליך', 'תקופה', 'רעיון', 'מקום'][options.length])
    return {
      question: index === 0 ? `על מי/מה הערך הזה בעיקר?` : `איזה מושג קשור מאוד לערך לפי הטקסט?`,
      options: options.sort(() => Math.random() - 0.5),
      answer,
    }
  })
}

function storyChapters(page: WikiPage) {
  const ps = paragraphs(page.extract)
  const labels = ['הכניסה לסיפור', 'הקונפליקט', 'נקודת המפנה', 'למה זה חשוב היום']
  return labels.map((label, i) => ({
    label,
    text: ps[i]?.slice(0, 520) || sentences(page.extract)[i] || 'אין מספיק מידע בחלק הזה.',
  }))
}

function makeSummary(page: WikiPage) {
  const first = paragraphs(page.extract)[0] || sentences(page.extract).slice(0, 2).join(' ')
  return first.slice(0, 650)
}

async function fetchWiki(input: string): Promise<WikiPage> {
  const { lang, title } = parseWikiInput(input)
  const api = `https://${lang}.wikipedia.org/w/api.php?` + new URLSearchParams({
    action: 'query',
    prop: 'extracts|pageimages|info',
    explaintext: '1',
    exintro: '0',
    redirects: '1',
    format: 'json',
    origin: '*',
    inprop: 'url',
    pithumbsize: '900',
    titles: title,
  }).toString()

  const response = await fetch(api)
  if (!response.ok) throw new Error('ויקיפדיה לא ענתה')
  const data = await response.json()
  const pages = Object.values(data.query?.pages || {}) as WikiPage[]
  const page = pages[0]
  if (!page || page.pageid === -1 || !page.extract) throw new Error('לא מצאתי ערך כזה')
  return { ...page, extract: cleanText(page.extract), lang }
}

function Loader() {
  return (
    <div className="rounded-[2rem] border border-emerald-900/10 bg-white/70 p-6 shadow-xl shadow-emerald-900/5">
      <div className="mb-4 h-4 w-32 animate-pulse rounded-full bg-emerald-200" />
      <div className="space-y-3">
        <div className="h-4 animate-pulse rounded-full bg-stone-200" />
        <div className="h-4 w-5/6 animate-pulse rounded-full bg-stone-200" />
        <div className="h-4 w-3/4 animate-pulse rounded-full bg-stone-200" />
      </div>
    </div>
  )
}

function App() {
  const [input, setInput] = useState(EXAMPLES[0])
  const [page, setPage] = useState<WikiPage | null>(null)
  const [mode, setMode] = useState<Mode>('story')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({})

  const timeline = useMemo(() => page ? buildTimeline(page.extract) : [], [page])
  const quiz = useMemo(() => page ? buildQuiz(page) : [], [page])
  const keywords = useMemo(() => page ? extractKeywords(page.extract) : [], [page])
  const chapters = useMemo(() => page ? storyChapters(page) : [], [page])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setSelectedAnswers({})
    try {
      const result = await fetchWiki(input)
      setPage(result)
      setMode('story')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'משהו נשבר')
    } finally {
      setLoading(false)
    }
  }

  const isRtl = page?.lang === 'he'

  return (
    <main className="min-h-screen overflow-hidden text-stone-950">
      <section className="relative px-4 py-6 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <header className="mb-8 flex items-center justify-between gap-4 rounded-full border border-white/60 bg-white/55 px-4 py-3 shadow-lg shadow-stone-900/5 backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-emerald-950 text-xl text-amber-100">W</div>
              <div>
                <p className="text-sm font-black tracking-tight">WikiAlive</p>
                <p className="text-xs text-stone-600">Wikipedia → experience</p>
              </div>
            </div>
            <a href="#demo" className="rounded-full bg-stone-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-900">
              נסה עכשיו
            </a>
          </header>

          <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="text-center lg:text-left">
              <p className="mb-4 inline-flex rounded-full border border-emerald-800/20 bg-emerald-100 px-4 py-2 text-sm font-bold text-emerald-950">
                ויקיפדיה, אבל חיה
              </p>
              <h1 className="mx-auto max-w-4xl text-5xl font-black leading-[0.95] tracking-[-0.05em] text-stone-950 sm:text-6xl lg:mx-0 lg:text-7xl">
                הופכים ערך משעמם למסע אינטראקטיבי.
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-stone-700 lg:mx-0">
                הדבק קישור ויקיפדיה. WikiAlive מחלץ את הערך, בונה תקציר, סיפור, ציר זמן, מושגים וקוויז — בלי הרשמה ובלי כאב ראש.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
                {['Story mode', 'Timeline', 'Quiz', 'Concept cards'].map((item) => (
                  <span key={item} className="rounded-full border border-stone-900/10 bg-white/70 px-4 py-2 text-sm font-bold text-stone-700">
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-6 rounded-[3rem] bg-gradient-to-br from-amber-300/40 via-emerald-300/30 to-purple-300/40 blur-3xl" />
              <div className="relative rounded-[2rem] border border-white/70 bg-white/75 p-5 shadow-2xl shadow-stone-900/10 backdrop-blur">
                <div className="mb-4 flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-red-400" />
                  <span className="h-3 w-3 rounded-full bg-amber-400" />
                  <span className="h-3 w-3 rounded-full bg-emerald-400" />
                </div>
                <div className="rounded-[1.5rem] bg-stone-950 p-5 text-left text-amber-50">
                  <p className="mb-3 text-xs uppercase tracking-[0.25em] text-emerald-200">input</p>
                  <p className="break-all text-sm text-stone-300">https://en.wikipedia.org/wiki/Napoleon</p>
                  <div className="my-5 h-px bg-white/10" />
                  <p className="mb-3 text-xs uppercase tracking-[0.25em] text-amber-200">output</p>
                  <div className="space-y-3">
                    <div className="rounded-2xl bg-white/10 p-4">
                      <p className="font-bold">פרק 1: עלייה מהירה</p>
                      <p className="mt-1 text-sm text-stone-300">הערך הופך לסיפור עם נקודות מפנה.</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded-xl bg-emerald-400/20 p-3">ציר זמן</div>
                      <div className="rounded-xl bg-amber-400/20 p-3">מושגים</div>
                      <div className="rounded-xl bg-purple-400/20 p-3">קוויז</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="demo" className="px-4 pb-16 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl rounded-[2.5rem] border border-white/70 bg-white/65 p-4 shadow-2xl shadow-stone-900/8 backdrop-blur sm:p-6 lg:p-8">
          <form onSubmit={onSubmit} className="grid gap-3 lg:grid-cols-[1fr_auto]">
            <label className="sr-only" htmlFor="wiki-url">Wikipedia URL</label>
            <input
              id="wiki-url"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="הדבק קישור ויקיפדיה או שם ערך"
              className="min-h-14 w-full rounded-2xl border border-stone-900/10 bg-white px-5 text-base font-semibold outline-none ring-emerald-700/20 transition focus:ring-4"
            />
            <button className="min-h-14 rounded-2xl bg-emerald-950 px-8 font-black text-white shadow-lg shadow-emerald-950/20 transition hover:-translate-y-0.5 hover:bg-emerald-800">
              הפוך למעניין
            </button>
          </form>
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button key={example} onClick={() => setInput(example)} className="rounded-full bg-stone-950/5 px-3 py-2 text-xs font-bold text-stone-700 hover:bg-stone-950/10">
                {example.includes('he.') ? 'דוגמה עברית' : example.split('/').pop()?.replaceAll('_', ' ')}
              </button>
            ))}
          </div>

          {error && <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-800">{error}</div>}
          {loading && <div className="mt-8"><Loader /></div>}

          {page && !loading && (
            <article dir={isRtl ? 'rtl' : 'ltr'} className="mt-8 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
              <aside className="space-y-6">
                <div className="overflow-hidden rounded-[2rem] border border-stone-900/10 bg-white shadow-xl shadow-stone-900/5">
                  {page.thumbnail?.source && <img src={page.thumbnail.source} alt="" className="h-64 w-full object-cover" />}
                  <div className="p-6">
                    <p className="text-sm font-black text-emerald-800">מקור: Wikipedia</p>
                    <h2 className="mt-2 text-4xl font-black tracking-tight text-stone-950">{page.title}</h2>
                    <p className="mt-4 leading-8 text-stone-700">{makeSummary(page)}</p>
                    {page.fullurl && (
                      <a href={page.fullurl} target="_blank" className="mt-5 inline-flex rounded-full bg-stone-950 px-5 py-3 text-sm font-bold text-white" rel="noreferrer">
                        פתח מקור
                      </a>
                    )}
                  </div>
                </div>
                <div className="rounded-[2rem] border border-stone-900/10 bg-amber-50 p-6">
                  <h3 className="text-xl font-black">מושגים חמים</h3>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {keywords.slice(0, 10).map((keyword) => (
                      <span key={keyword} className="rounded-full bg-white px-3 py-2 text-sm font-bold text-stone-700 shadow-sm">{keyword}</span>
                    ))}
                  </div>
                </div>
              </aside>

              <section className="rounded-[2rem] border border-stone-900/10 bg-white p-4 shadow-xl shadow-stone-900/5 sm:p-6">
                <div className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-4">
                  {([
                    ['story', 'Story'],
                    ['timeline', 'Timeline'],
                    ['quiz', 'Quiz'],
                    ['cards', 'Cards'],
                  ] as [Mode, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setMode(key)}
                      className={`rounded-2xl px-4 py-3 text-sm font-black transition ${mode === key ? 'bg-emerald-950 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {mode === 'story' && (
                  <div className="space-y-4">
                    {chapters.map((chapter, i) => (
                      <div key={chapter.label} className="rounded-3xl border border-stone-900/10 bg-gradient-to-br from-white to-emerald-50 p-5">
                        <p className="text-sm font-black text-emerald-800">פרק {i + 1}</p>
                        <h3 className="mt-1 text-2xl font-black text-stone-950">{chapter.label}</h3>
                        <p className="mt-3 leading-8 text-stone-700">{chapter.text}</p>
                      </div>
                    ))}
                  </div>
                )}

                {mode === 'timeline' && (
                  <div className="space-y-4">
                    {timeline.length ? timeline.map((item) => (
                      <div key={`${item.year}-${item.text}`} className="grid gap-3 rounded-3xl border border-stone-900/10 bg-stone-50 p-5 sm:grid-cols-[110px_1fr]">
                        <div className="text-3xl font-black text-emerald-900">{item.year}</div>
                        <p className="leading-8 text-stone-700">{item.text}</p>
                      </div>
                    )) : <p className="rounded-3xl bg-stone-100 p-6 font-bold">לא מצאתי שנים ברורות בערך הזה. נסה מצב Story.</p>}
                  </div>
                )}

                {mode === 'quiz' && (
                  <div className="space-y-5">
                    {quiz.map((q, idx) => {
                      const selected = selectedAnswers[idx]
                      return (
                        <div key={idx} className="rounded-3xl border border-stone-900/10 bg-purple-50 p-5">
                          <h3 className="text-xl font-black">{idx + 1}. {q.question}</h3>
                          <div className="mt-4 grid gap-2 sm:grid-cols-2">
                            {q.options.map((option) => {
                              const isCorrect = selected && option === q.answer
                              const isWrong = selected === option && option !== q.answer
                              return (
                                <button
                                  key={option}
                                  onClick={() => setSelectedAnswers((prev) => ({ ...prev, [idx]: option }))}
                                  className={`rounded-2xl border px-4 py-3 text-start font-bold transition ${isCorrect ? 'border-emerald-600 bg-emerald-100 text-emerald-950' : isWrong ? 'border-red-500 bg-red-50 text-red-800' : 'border-stone-900/10 bg-white hover:bg-stone-50'}`}
                                >
                                  {option}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {mode === 'cards' && (
                  <div className="grid gap-4 md:grid-cols-2">
                    {paragraphs(page.extract).slice(0, 8).map((p, i) => (
                      <div key={i} className="rounded-3xl border border-stone-900/10 bg-gradient-to-br from-amber-50 to-white p-5">
                        <p className="text-sm font-black text-amber-700">כרטיס #{i + 1}</p>
                        <p className="mt-2 leading-7 text-stone-700">{p.slice(0, 330)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </article>
          )}
        </div>
      </section>

      <footer className="px-4 pb-8 text-center text-sm font-semibold text-stone-600">
        Built as an MVP. Content from Wikipedia, licensed under CC BY-SA. Always link back to original article.
      </footer>
    </main>
  )
}

export default App
