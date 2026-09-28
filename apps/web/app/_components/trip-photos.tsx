'use client'

import { deleteTripPhoto, TRIP_PHOTO_BATCH_MAX, type TripPhoto, type TripPhotosValue } from '@ghar/contracts'
import { Dialog } from 'radix-ui'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition, type ChangeEvent } from 'react'
import { ConfirmDialog } from '@/app/(app)/_components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api, errorMessage } from '@/lib/api/client'
import { addPhotoToTrip, UploadError } from '@/lib/travel/photo-upload'

// The trip's shared album. Everyone on the trip sees it; the household and its guests add to it.
// Photos are shrunk and stripped of their location on the phone, then go straight to private
// storage. The links to them are signed and short-lived, so the page asks again when they lapse.

export function TripPhotos({ tripId, value }: { tripId: string; value: TripPhotosValue }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, startRefresh] = useTransition()
  const [open, setOpen] = useState<number | null>(null)
  const retried = useRef(false)
  // The viewer stays open until the photo is really gone, so a failure shows beside it. Closed
  // meanwhile, the failure shows above the album instead.
  const remove = useMutation(async (photoId: string) => {
    await api.request(deleteTripPhoto, { params: { tripId, photoId } })
    setOpen(null)
  })

  const add = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])].slice(0, Math.min(TRIP_PHOTO_BATCH_MAX, value.room))
    event.target.value = ''
    if (files.length === 0) return
    setError(null)
    const failures: string[] = []
    for (const [index, file] of files.entries()) {
      setProgress({ done: index + 1, total: files.length })
      try {
        await addPhotoToTrip(tripId, file)
      } catch (cause) {
        failures.push(cause instanceof UploadError ? cause.message : errorMessage(cause))
      }
    }
    setProgress(null)
    if (failures.length === 1) setError(failures[0] ?? null)
    else if (failures.length > 1) setError(`${String(failures.length)} photos didn’t upload. ${failures[0] ?? ''}`)
    startRefresh(() => {
      router.refresh()
    })
  }

  // The signed links last an hour. A page left open longer gets fresh ones, once.
  const onBroken = () => {
    if (retried.current) return
    retried.current = true
    startRefresh(() => {
      router.refresh()
    })
  }

  const busy = progress !== null || refreshing
  const current = open === null ? null : (value.photos[open] ?? null)

  return (
    <section aria-labelledby='photos-heading' className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div className='flex flex-col gap-1'>
          <h2 id='photos-heading' className='text-lg font-semibold'>
            Photos
          </h2>
          <p className='text-sm text-ink-muted'>Everyone’s photos from the trip, in one place.</p>
        </div>
        {value.canAdd && value.photos.length > 0 ? (
          <Button type='button' variant='outline' disabled={busy || value.room === 0} onClick={() => input.current?.click()}>
            Add photos
          </Button>
        ) : null}
      </div>

      {value.canAdd ? (
        <input
          ref={input}
          type='file'
          accept='image/*'
          multiple
          className='sr-only'
          tabIndex={-1}
          aria-hidden
          onChange={event => {
            void add(event)
          }}
        />
      ) : null}

      {progress ? (
        <p role='status' className='text-sm text-ink-muted tabular-nums'>
          Adding {progress.done} of {progress.total}…
        </p>
      ) : null}
      <FormError>{error}</FormError>
      <FormError>{open === null ? remove.error : null}</FormError>

      {value.photos.length === 0 ? (
        <div className='flex flex-col items-start gap-2 rounded-card border border-dashed border-line px-4 py-6'>
          <p className='text-base font-medium'>No photos yet</p>
          <p className='text-sm text-ink-muted'>
            {value.canAdd
              ? 'Add your photos from the trip so everyone has them. Location details are taken off before they upload.'
              : 'When people on the trip add photos, they’ll show up here.'}
          </p>
          {value.canAdd ? (
            <div className='pt-1'>
              <Button type='button' disabled={busy} onClick={() => input.current?.click()}>
                Add photos
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <ul className='grid grid-cols-3 gap-1 md:grid-cols-4'>
          {value.photos.map((photo, index) => (
            <li key={photo.id}>
              <button
                type='button'
                className='block aspect-square w-full overflow-hidden rounded-control bg-line outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-paper'
                onClick={() => {
                  setOpen(index)
                }}
                aria-label={photo.caption ?? `Photo${photo.addedBy ? ` from ${photo.addedBy}` : ''}`}
              >
                <img src={photo.url} alt='' loading='lazy' decoding='async' className='size-full object-cover' onError={onBroken} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <PhotoViewer
        photo={current}
        position={open}
        count={value.photos.length}
        onMove={setOpen}
        onClose={() => {
          setOpen(null)
        }}
        onRemove={remove.mutate}
        removing={remove.pending}
        removeError={remove.error}
      />
    </section>
  )
}

function PhotoViewer({
  photo,
  position,
  count,
  onMove,
  onClose,
  onRemove,
  removing,
  removeError,
}: {
  photo: TripPhoto | null
  position: number | null
  count: number
  onMove: (index: number) => void
  onClose: () => void
  onRemove: (photoId: string) => void
  removing: boolean
  removeError: string | null
}) {
  const at = position ?? 0
  const byline = photo ? (photo.mine ? 'Added by you' : photo.addedBy ? `Added by ${photo.addedBy}` : null) : null

  return (
    <Dialog.Root
      open={photo !== null}
      onOpenChange={next => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className='fixed inset-0 z-50 bg-ink/90 motion-safe:data-[state=closed]:animate-fade-out motion-safe:data-[state=open]:animate-fade-in' />
        <Dialog.Content
          className='fixed inset-0 z-50 flex flex-col gap-3 px-4 pt-[max(--spacing(4),env(safe-area-inset-top))] pb-[max(--spacing(4),env(safe-area-inset-bottom))] focus:outline-hidden'
          onKeyDown={event => {
            if (event.key === 'ArrowLeft' && at > 0) onMove(at - 1)
            if (event.key === 'ArrowRight' && at < count - 1) onMove(at + 1)
          }}
        >
          <div className='flex items-center justify-between gap-3'>
            <Dialog.Title className='text-sm text-surface tabular-nums'>
              Photo {at + 1} of {count}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button type='button' variant='outline'>
                Close
              </Button>
            </Dialog.Close>
          </div>
          <div className='flex min-h-0 flex-1 items-center justify-center'>
            {photo ? (
              <img src={photo.url} alt={photo.caption ?? ''} className='max-h-full max-w-full rounded-control object-contain' />
            ) : null}
          </div>
          <div className='mx-auto flex w-full max-w-content flex-col gap-3'>
            {photo?.caption || byline ? (
              <Dialog.Description className='text-base text-surface'>
                {photo?.caption ? <span className='block'>{photo.caption}</span> : null}
                {byline ? <span className='block text-sm text-surface/70'>{byline}</span> : null}
              </Dialog.Description>
            ) : (
              <Dialog.Description className='sr-only'>A photo from the trip</Dialog.Description>
            )}
            <div className='flex flex-wrap items-center gap-2'>
              <Button
                type='button'
                variant='outline'
                disabled={at === 0}
                onClick={() => {
                  onMove(at - 1)
                }}
              >
                Previous
              </Button>
              <Button
                type='button'
                variant='outline'
                disabled={at >= count - 1}
                onClick={() => {
                  onMove(at + 1)
                }}
              >
                Next
              </Button>
              {photo?.canDelete ? (
                <div className='ml-auto'>
                  <ConfirmDialog
                    trigger={
                      <Button type='button' variant='outline' disabled={removing}>
                        {removing ? 'Taking down…' : 'Take down'}
                      </Button>
                    }
                    title='Take this photo down?'
                    description='It comes out of the album for everyone on the trip.'
                    confirmLabel='Take down'
                    tone='destructive'
                    onConfirm={() => {
                      onRemove(photo.id)
                    }}
                  />
                </div>
              ) : null}
            </div>
            <FormError>{removeError}</FormError>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
