type Subscriber = () => void

export class ShareRealtimeBroker {
  private readonly subscribers = new Map<string, Set<Subscriber>>()

  subscribe(shareId: string, subscriber: Subscriber): () => void {
    const existing = this.subscribers.get(shareId) ?? new Set<Subscriber>()
    existing.add(subscriber)
    this.subscribers.set(shareId, existing)

    return () => {
      existing.delete(subscriber)
      if (existing.size === 0) {
        this.subscribers.delete(shareId)
      }
    }
  }

  publish(shareId: string): number {
    const subscribers = this.subscribers.get(shareId)
    if (!subscribers) {
      return 0
    }
    for (const subscriber of [...subscribers]) {
      subscriber()
    }
    return subscribers.size
  }

  publishAll(): number {
    let delivered = 0
    for (const shareId of [...this.subscribers.keys()]) {
      delivered += this.publish(shareId)
    }
    return delivered
  }
}
