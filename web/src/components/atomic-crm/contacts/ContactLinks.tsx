import { cn } from "@/lib/utils";

/** A value the server already masked (PUBLIC_MODE) is text, never a link. */
const isMasked = (value: string) => /[*•]/.test(value);

const linkClass = "underline-offset-2 hover:underline";

/** An email address as a mailto: link, or "Not recorded" when the donor has none. */
export const EmailLink = ({
  email,
  className,
}: {
  email: string | null | undefined;
  className?: string;
}) =>
  !email ? (
    <>Not recorded</>
  ) : isMasked(email) ? (
    <>{email}</>
  ) : (
    <a href={`mailto:${email}`} className={cn(linkClass, className)}>
      {email}
    </a>
  );

/** A phone number as a tel: link, or "Not recorded" when the donor has none. */
export const PhoneLink = ({
  phone,
  className,
}: {
  phone: string | null | undefined;
  className?: string;
}) =>
  !phone ? (
    <>Not recorded</>
  ) : isMasked(phone) ? (
    <>{phone}</>
  ) : (
    <a
      href={`tel:${phone.replace(/[^\d+]/g, "")}`}
      className={cn(linkClass, className)}
    >
      {phone}
    </a>
  );
