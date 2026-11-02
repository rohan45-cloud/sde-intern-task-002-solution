import type { Bill } from '../api'
import { formatCents } from '../money'

type Props = {
  bill: Bill
  memberNames: ReadonlyMap<string, string>
  paying: ReadonlySet<string>
  payErrors: Readonly<Record<string, string>>
  onPay: (shareId: string) => void
}

export function BillCard({ bill, memberNames, paying, payErrors, onPay }: Props) {
  const unpaid = bill.shares.filter((share) => share.paidAt === null).length

  return (
    <article className="card bill">
      <header className="bill-head">
        <h3>{bill.title}</h3>
        <span className="amount big">{formatCents(bill.totalCents)}</span>
      </header>
      <p className="muted">
        {unpaid === 0 ? 'All shares paid' : `${unpaid} of ${bill.shares.length} shares unpaid`}
      </p>
      <ul className="shares">
        {bill.shares.map((share) => {
          const isPaying = paying.has(share.id)
          const error = payErrors[share.id]
          return (
            <li key={share.id}>
              <div className="share-line">
                <span className="grow">{memberNames.get(share.memberId) ?? 'Unknown member'}</span>
                <span className="amount">{formatCents(share.amountCents)}</span>
                {share.paidAt ? (
                  <span className="badge paid">
                    Paid {new Date(share.paidAt).toLocaleDateString()}
                  </span>
                ) : (
                  <button type="button" disabled={isPaying} onClick={() => onPay(share.id)}>
                    {isPaying ? 'Paying…' : error ? 'Retry payment' : 'Pay'}
                  </button>
                )}
              </div>
              {error && !share.paidAt && (
                <p className="field-error" role="alert">
                  Payment failed: {error}. The share is still unpaid.
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </article>
  )
}
