'use client'

import {
  createTripIdea,
  deleteTripIdea,
  previewLink,
  promoteTripIdea,
  voteOnTripIdea,
  type LinkPreview,
  type TripIdea,
} from '@ghar/contracts'
import { compareIdeasByVotes, tallyVotes, voteOf } from '@ghar/core/ideas'
import { useRouter } from 'next/navigation'
import { useRef, useState, type SyntheticEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, Input } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api, errorMessage } from '@/lib/api/client'

/**
 * The pile of places nobody has committed to yet. Paste a link and the server reads its
 * OpenGraph tags for a title and a picture; vote on what the household actually wants;
 * promote the winner and it becomes a trip.
 */
export function IdeaBoard({ ideas, currentUserId }: { ideas: TripIdea[]; currentUserId: string }) {
  const ranked = [...ideas].sort(compareIdeasByVotes)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [announcement, setAnnouncement] = useState('')

  return (
    <section className='flex flex-col gap-3'>
      <h2 ref={headingRef} tabIndex={-1} className='text-lg font-semibold'>
        Ideas
      </h2>
      <p role='status' className='sr-only'>
        {announcement}
      </p>
      <IdeaForm />

      {ranked.length === 0 ? (
        <EmptyState title='Nothing on the board'>
          Paste a link to somewhere you would go and it lands here for everyone to vote on.
        </EmptyState>
      ) : (
        <ul className='grid gap-3 md:grid-cols-2'>
          {ranked.map(idea => (
            <li key={idea.id}>
              <IdeaCard
                idea={idea}
                currentUserId={currentUserId}
                onRemoved={() => {
                  // The card and its Remove button are about to go, so focus lands somewhere that stays.
                  setAnnouncement(`Removed ${idea.title}`)
                  headingRef.current?.focus()
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Paste a URL, get a title and an image back. The lookup is a separate step from saving so
 * the person sees what was found before it goes on the board, and can overwrite the title
 * when a site names its page badly.
 */
function IdeaForm() {
  const [preview, setPreview] = useState<LinkPreview | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')

  const { mutate, pending, error } = useMutation(async (input: { title: string }) => {
    await api.request(createTripIdea, {
      body: {
        title: input.title,
        url: url.trim() || null,
        imageUrl: preview?.imageUrl ?? null,
        destination: preview?.siteName ?? null,
        notes: preview?.description ?? null,
      },
    })
    setPreview(null)
    setTitle('')
    setUrl('')
  })

  const look = async () => {
    const trimmed = url.trim()
    if (trimmed === '') return
    setLookupError(null)
    setLooking(true)
    try {
      const { preview: found } = await api.request(previewLink, { body: { url: trimmed } })
      setPreview(found)
      // Only fill the title in when the person has not written their own.
      if (found.title && title.trim() === '') setTitle(found.title)
      if (!found.title) {
        setLookupError('That page does not say what it is. Give it a title yourself.')
      }
    } catch (cause) {
      setLookupError(errorMessage(cause))
    } finally {
      setLooking(false)
    }
  }

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (title.trim() === '') return
    mutate({ title: title.trim() })
  }

  return (
    <Card className='p-4 md:p-5'>
      <form onSubmit={onSubmit} className='flex flex-col gap-4'>
        <div className='grid gap-4 md:grid-cols-[1fr_auto]'>
          <Field label='Paste a link' hint="We read the page's title and picture, nothing else.">
            <Input
              name='url'
              type='url'
              inputMode='url'
              value={url}
              placeholder='https://'
              onChange={event => {
                setUrl(event.target.value)
                setPreview(null)
              }}
            />
          </Field>
          <Button
            type='button'
            variant='outline'
            className='md:mt-7'
            disabled={looking || url.trim() === ''}
            onClick={() => {
              void look()
            }}
          >
            {looking ? 'Looking…' : 'Look it up'}
          </Button>
        </div>

        {preview?.imageUrl ? (
          <div className='flex items-center gap-3 rounded-control border border-line p-2'>
            <img
              src={preview.imageUrl}
              alt=''
              width={64}
              height={64}
              decoding='async'
              className='size-16 shrink-0 rounded-control object-cover'
            />
            <p className='min-w-0 text-sm text-ink-muted'>{preview.siteName ?? 'Found a picture for this one.'}</p>
          </div>
        ) : null}

        <Field label='Title'>
          <Input
            name='title'
            required
            maxLength={200}
            value={title}
            placeholder='Somewhere worth going'
            onChange={event => {
              setTitle(event.target.value)
            }}
          />
        </Field>

        <FormError>{lookupError ?? error}</FormError>

        <div>
          <Button type='submit' disabled={pending || title.trim() === ''}>
            {pending ? 'Adding…' : 'Add to the board'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function IdeaCard({ idea, currentUserId, onRemoved }: { idea: TripIdea; currentUserId: string; onRemoved: () => void }) {
  const router = useRouter()
  const tally = tallyVotes(idea.votes)
  const mine = voteOf(idea.votes, currentUserId)

  const vote = useMutation((next: 'up' | 'down') => api.request(voteOnTripIdea, { params: { ideaId: idea.id }, body: { vote: next } }))
  const remove = useMutation(async () => {
    await api.request(deleteTripIdea, { params: { ideaId: idea.id } })
    onRemoved()
  })
  const promote = useMutation(async () => {
    const { tripId } = await api.request(promoteTripIdea, {
      params: { ideaId: idea.id },
      body: {},
    })
    router.push(`/travel/${tripId}`)
  })

  return (
    <Card className='flex h-full flex-col overflow-hidden'>
      {/* Remote pictures from any site, so next/image can't size them; the attributes still reserve the space. */}
      {idea.imageUrl ? (
        <img src={idea.imageUrl} alt='' width={400} height={128} loading='lazy' decoding='async' className='h-32 w-full object-cover' />
      ) : null}

      <div className='flex flex-1 flex-col gap-3 p-4 md:p-5'>
        <div>
          <p className='font-semibold'>{idea.title}</p>
          {idea.destination ? <p className='text-sm text-ink-muted'>{idea.destination}</p> : null}
          {idea.url ? (
            <a
              href={idea.url}
              target='_blank'
              rel='noreferrer noopener'
              className='inline-block min-h-tap max-w-full truncate align-top text-sm leading-11 text-ink underline underline-offset-4'
            >
              {idea.url}
            </a>
          ) : null}
        </div>

        <div className='mt-auto flex flex-wrap items-center gap-2'>
          <div className='flex items-center gap-1'>
            <Button
              variant={mine === 'up' ? 'default' : 'outline'}
              size='icon'
              aria-label={mine === 'up' ? 'Take back your vote' : `Vote for ${idea.title}`}
              aria-pressed={mine === 'up'}
              disabled={vote.pending}
              onClick={() => {
                vote.mutate('up')
              }}
            >
              <span aria-hidden>+</span>
            </Button>
            <span className='min-w-8 text-center text-sm tabular-nums'>{tally.score}</span>
            <Button
              variant={mine === 'down' ? 'default' : 'outline'}
              size='icon'
              aria-label={mine === 'down' ? 'Take back your vote' : `Vote against ${idea.title}`}
              aria-pressed={mine === 'down'}
              disabled={vote.pending}
              onClick={() => {
                vote.mutate('down')
              }}
            >
              <span aria-hidden>−</span>
            </Button>
          </div>

          <Button
            variant='outline'
            disabled={promote.pending}
            onClick={() => {
              promote.mutate()
            }}
          >
            {promote.pending ? 'Making a trip…' : 'Make it a trip'}
          </Button>
          <Button
            variant='ghost'
            disabled={remove.pending}
            onClick={() => {
              remove.mutate()
            }}
          >
            Remove
          </Button>
        </div>

        <FormError>{vote.error ?? promote.error ?? remove.error}</FormError>
      </div>
    </Card>
  )
}
