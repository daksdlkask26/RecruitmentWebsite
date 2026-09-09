"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useCsrfProof } from "@/frontend/features/authentication/client/csrf-proof-context";
import {
  useWorkspaceLocale,
  type WorkspaceLocale,
} from "@/frontend/features/dashboard/client/workspace-locale";
import { CompanyAvatar } from "@/frontend/features/jobs/components/company-avatar";
import {
  companyLogoSchema,
  type RecruiterCompanySettings,
  type RecruiterCompanySettingsInput,
} from "@/shared/contracts/jobs/catalog";
import { MAX_OWNED_COMPANIES_PER_USER } from "@/shared/contracts/company-ownership";
import { RECRUITER_AUTHORITY_CHANGED_EVENT } from "@/shared/contracts/recruiter-header-status";
import styles from "./company-settings-screen.module.css";
import {
  ALL_RECRUITER_COMPANIES,
  useRecruiterCompanyScope,
} from "./recruiter-company-scope";
import { getCompanyTeamCopy } from "./company-team-copy";
import {
  recruiterWorkspaceCopy,
  type RecruiterWorkspaceCopy,
} from "./recruiter-workspace-copy";

type Props = {
  initialCompany: RecruiterCompanySettings | null;
  initialCompanies?: RecruiterCompanySettings[];
  canManageTeam?: boolean;
  initialCompanyId?: string;
  initialDeletionRequestId?: string;
};
type FormState = RecruiterCompanySettingsInput;
type FieldName = "name" | "industry" | "size" | "address" | "logo";
type FieldErrors = Partial<Record<FieldName | "website", string>>;
type DeletionReceiptStatus =
  | "BLOCKED"
  | "PENDING"
  | "RETRY_REQUIRED"
  | "COMPLETED";
type DeletionReceipt = Readonly<{
  requestId: string;
  status: DeletionReceiptStatus;
}>;

function emptyForm(): FormState {
  return {
    name: "",
    logo: null,
    size: "",
    industry: "",
    address: "",
    website: null,
    description: null,
    foundedYear: null,
  };
}

const MAX_LOGO_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_LOGO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DESCRIPTION_MIN_HEIGHT = 90;
const profileFields: Array<{ key: FieldName; label: string }> = [
  { key: "name", label: "Company name" },
  { key: "industry", label: "Industry" },
  { key: "size", label: "Company size" },
  { key: "address", label: "Address" },
  { key: "logo", label: "Company logo" },
];

function companyProfileFieldLabel(
  field: FieldName,
  copy: RecruiterWorkspaceCopy,
) {
  switch (field) {
    case "name":
      return copy.companyName;
    case "industry":
      return copy.industry;
    case "size":
      return copy.companySize;
    case "address":
      return copy.address;
    case "logo":
      return copy.logo;
  }
}

function formFromCompany(company: RecruiterCompanySettings): FormState {
  return {
    name: company.name,
    logo: company.logo,
    size: company.size,
    industry: company.industry,
    address: company.address,
    website: company.website,
    description: company.description,
    foundedYear: company.foundedYear,
  };
}

function resizeDescription(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  element.style.height = `${Math.max(element.scrollHeight, DESCRIPTION_MIN_HEIGHT)}px`;
}

function statusClass(status: RecruiterCompanySettings["verificationStatus"]) {
  if (status === "approved") return styles.badgeGood;
  if (status === "rejected") return styles.badgeError;
  return styles.badgeWarning;
}

function statusLabel(
  status: RecruiterCompanySettings["verificationStatus"],
  copy: RecruiterWorkspaceCopy,
) {
  return status === "approved"
    ? copy.verificationStatus.approved
    : status === "rejected"
      ? copy.verificationStatus.rejected
      : copy.verificationStatus.pending;
}

function statusIcon(status: RecruiterCompanySettings["verificationStatus"]) {
  return status === "approved" ? "✓" : status === "rejected" ? "!" : "•";
}

type ProfileValidation = {
  missingFields: FieldName[];
  fieldErrors: Partial<Record<FieldName, string>>;
};

export function getCompanyProfileValidation(
  form: FormState,
  locale: WorkspaceLocale = "en",
): ProfileValidation {
  const copy = recruiterWorkspaceCopy(locale);
  const missingFields: FieldName[] = [];
  const fieldErrors: Partial<Record<FieldName, string>> = {};

  for (const { key } of profileFields) {
    const label = companyProfileFieldLabel(key, copy);
    const value = form[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      missingFields.push(key);
      fieldErrors[key] =
        locale === "vi"
          ? `${label} là trường bắt buộc.`
          : `${label} is required.`;
      continue;
    }

    if (key === "logo" && !companyLogoSchema.safeParse(value).success) {
      missingFields.push(key);
      fieldErrors[key] =
        locale === "vi"
          ? "Hãy chọn logo PNG, JPEG hoặc WebP đã lưu trước khi đăng tin tuyển dụng."
          : "Choose a saved PNG, JPEG, or WebP logo before posting a job.";
    }
  }

  if (process.env.NODE_ENV !== "production") {
    console.debug("[recruiter] posting gate validation", {
      fields: profileFields.map(({ key }) => ({
        field: key,
        value:
          key === "logo" ? (form[key] ? "[uploaded logo]" : null) : form[key],
        valid: !fieldErrors[key],
        reason: fieldErrors[key] ?? null,
      })),
      profileComplete: missingFields.length === 0,
    });
  }

  return { missingFields, fieldErrors };
}

function validateForm(
  form: FormState,
  locale: WorkspaceLocale = "en",
): FieldErrors {
  const errors: FieldErrors = {};
  Object.assign(errors, getCompanyProfileValidation(form, locale).fieldErrors);
  if (form.website) {
    try {
      new URL(form.website);
    } catch {
      errors.website =
        locale === "vi"
          ? "Hãy nhập URL website hợp lệ."
          : "Enter a valid website URL.";
    }
  }
  return errors;
}

function readFileAsDataUrl(file: File, copy: RecruiterWorkspaceCopy) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error(copy.unableToSave));
    };
    reader.onerror = () => reject(new Error(copy.unableToSave));
    reader.readAsDataURL(file);
  });
}

async function optimizeLogo(file: File, locale: WorkspaceLocale) {
  const copy = recruiterWorkspaceCopy(locale);
  if (!ACCEPTED_LOGO_TYPES.has(file.type) || file.size > MAX_LOGO_FILE_BYTES) {
    throw new Error(
      locale === "vi"
        ? "Hãy chọn logo PNG, JPEG hoặc WebP có dung lượng tối đa 5 MB."
        : "Choose a PNG, JPEG, or WebP logo up to 5 MB.",
    );
  }
  const source = await readFileAsDataUrl(file, copy);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const loaded = new window.Image();
    loaded.onload = () => resolve(loaded);
    loaded.onerror = () => reject(new Error(copy.unableToSave));
    loaded.src = source;
  });
  const maxDimension = 512;
  const scale = Math.min(
    1,
    maxDimension / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error(
      locale === "vi"
        ? "Không thể xem trước logo trong trình duyệt này."
        : "The logo preview is unavailable in this browser.",
    );
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const webp = canvas.toDataURL("image/webp", 0.86);
  const result = webp.startsWith("data:image/webp")
    ? webp
    : canvas.toDataURL("image/jpeg", 0.86);
  if (result.length > 1_100_000) {
    throw new Error(
      locale === "vi"
        ? "Hãy chọn ảnh logo đơn giản hơn, dưới 800 KB sau khi nén."
        : "Choose a simpler logo image under 800 KB after compression.",
    );
  }
  return result;
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="5.5"
        y="10"
        width="13"
        height="10"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <small className={styles.fieldError} id={id} role="alert">
      {message}
    </small>
  ) : null;
}

function fieldClass(hasError: boolean) {
  return hasError ? `${styles.field} ${styles.error}` : styles.field;
}

export function CompanySettingsScreen({
  initialCompany,
  initialCompanies,
  canManageTeam = false,
  initialCompanyId,
  initialDeletionRequestId,
}: Props) {
  const router = useRouter();
  const locale = useWorkspaceLocale();
  const copy = recruiterWorkspaceCopy(locale);
  const teamCopy = getCompanyTeamCopy(locale);
  const csrfProof = useCsrfProof();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const deleteConfirmationRef = useRef<HTMLInputElement>(null);
  const deletionReceiptHeadingRef = useRef<HTMLHeadingElement>(null);
  const [companies, setCompanies] = useState<RecruiterCompanySettings[]>(
    initialCompanies?.length
      ? initialCompanies
      : initialCompany
        ? [initialCompany]
        : [],
  );
  const [company, setCompany] = useState(initialCompany);
  const { selectedCompanyId, setCompanyId } =
    useRecruiterCompanyScope(companies);
  const [explicitCompanyId, setExplicitCompanyId] = useState(
    initialCompanyId ?? null,
  );
  const [form, setForm] = useState<FormState>(
    initialCompany ? formFromCompany(initialCompany) : emptyForm(),
  );
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [deletionRequestId, setDeletionRequestId] = useState<string | null>(
    initialDeletionRequestId ?? null,
  );
  const [deletionReceipt, setDeletionReceipt] =
    useState<DeletionReceipt | null>(null);
  const [deletionReceiptBusy, setDeletionReceiptBusy] = useState(false);
  const [deletionReceiptError, setDeletionReceiptError] = useState("");
  const [isEditing, setIsEditing] = useState(!initialCompany?.profileComplete);

  const activeCompanyId =
    explicitCompanyId ??
    selectedCompanyId ??
    company?.id ??
    companies[0]?.id ??
    null;

  useEffect(() => {
    if (!activeCompanyId || activeCompanyId === company?.id) return;
    const nextCompany = companies.find((item) => item.id === activeCompanyId);
    if (!nextCompany) return;
    // Synchronize the editable form with the company selected in the shared
    // workspace scope. This is intentionally a state transition from the
    // external company selector into this screen's local form state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCompany(nextCompany);
    setForm(formFromCompany(nextCompany));
    setIsEditing(!nextCompany.profileComplete);
    setMessage("");
    setError("");
    setFieldErrors({});
  }, [activeCompanyId, companies, company?.id]);

  useLayoutEffect(() => {
    if (isEditing && descriptionRef.current) {
      resizeDescription(descriptionRef.current);
    }
  }, [form.description, isEditing]);

  useEffect(() => {
    if (!deleteDialogOpen) return;
    deleteConfirmationRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleteBusy) {
        setDeleteDialogOpen(false);
        setDeleteConfirmation("");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [deleteBusy, deleteDialogOpen]);

  function updateField<K extends keyof FormState>(
    field: K,
    value: FormState[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function selectLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setLogoBusy(true);
    setError("");
    setMessage("");
    try {
      const logo = await optimizeLogo(file, locale);
      updateField("logo", logo);
      setMessage(copy.logoReady);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.unableToSave);
      setFieldErrors((current) => ({
        ...current,
        logo: copy.chooseValidImage,
      }));
    } finally {
      setLogoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validateForm(form, locale);
    setFieldErrors(errors);
    setMessage("");
    setError("");
    if (Object.keys(errors).length) {
      setError(copy.saveRequiredFields);
      const firstField = Object.keys(errors)[0];
      document.getElementById(`company-${firstField}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const companyQuery = company?.id
        ? `?companyId=${encodeURIComponent(company.id)}`
        : "";
      const response = await fetch(`/api/recruiter/company${companyQuery}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfProof,
        },
        body: JSON.stringify(form),
      });
      const payload =
        (await response.json()) as Partial<RecruiterCompanySettings> & {
          message?: string;
          fieldErrors?: FieldErrors;
        };
      if (!response.ok || !payload.id) {
        setFieldErrors(payload.fieldErrors ?? {});
        throw new Error(copy.unableToSave);
      }
      const savedCompany = payload as RecruiterCompanySettings;
      setCompany(savedCompany);
      setCompanies((current) =>
        current.some((item) => item.id === savedCompany.id)
          ? current.map((item) =>
              item.id === savedCompany.id ? savedCompany : item,
            )
          : [...current, savedCompany],
      );
      setForm(formFromCompany(savedCompany));
      setMessage(copy.profileSaved);
      setIsEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.unableToSave);
    } finally {
      setBusy(false);
    }
  }

  function openDeleteDialog() {
    if (!company || busy || deleteBusy) return;
    setDeleteConfirmation("");
    setDeleteDialogOpen(true);
  }

  function closeDeleteDialog() {
    if (deleteBusy) return;
    setDeleteDialogOpen(false);
    setDeleteConfirmation("");
  }

  const reloadDeletionReceipt = useCallback(async (requestId: string) => {
    setDeletionRequestId(requestId);
    setDeletionReceiptBusy(true);
    setDeletionReceiptError("");
    try {
      const response = await fetch(
        `/api/recruiter/company/deletion/${encodeURIComponent(requestId)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        requestId?: string;
        status?: DeletionReceiptStatus;
      };
      if (!response.ok || !payload.requestId || !payload.status) {
        throw new Error(copy.deletionStatusUnavailable);
      }
      setDeletionReceipt({
        requestId: payload.requestId,
        status: payload.status,
      });
      return true;
    } catch (caught) {
      setDeletionReceiptError(
        caught instanceof Error
          ? caught.message
          : copy.deletionStatusUnavailable,
      );
      return false;
    } finally {
      setDeletionReceiptBusy(false);
    }
  }, [copy.deletionStatusUnavailable]);

  useEffect(() => {
    if (!initialDeletionRequestId) return;
    const refresh = window.setTimeout(() => {
      void reloadDeletionReceipt(initialDeletionRequestId);
    }, 0);
    return () => window.clearTimeout(refresh);
  }, [initialDeletionRequestId, reloadDeletionReceipt]);

  useEffect(() => {
    if (!deletionReceipt) return;
    deletionReceiptHeadingRef.current?.focus();
  }, [deletionReceipt]);

  async function deleteCompany() {
    const selectedCompany = company;
    if (!selectedCompany || busy || deleteBusy) return;
    if (deleteConfirmation.trim() !== selectedCompany.name.trim()) return;

    setDeleteBusy(true);
    setMessage("");
    setError("");
    setFieldErrors({});
    try {
      const companyQuery = `?companyId=${encodeURIComponent(selectedCompany.id)}`;
      const response = await fetch(`/api/recruiter/company${companyQuery}`, {
        method: "DELETE",
        headers: { "X-CSRF-Token": csrfProof },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        deleted?: boolean;
        requestId?: string;
        status?: "BLOCKED_BY_LEGAL_HOLD" | "PURGE_PENDING";
        message?: string;
      };
      if (
        payload.requestId &&
        (payload.status === "BLOCKED_BY_LEGAL_HOLD" ||
          payload.status === "PURGE_PENDING")
      ) {
        setDeleteDialogOpen(false);
        setDeleteConfirmation("");
        router.push(
          `/recruiter/company-settings?deletionRequestId=${encodeURIComponent(payload.requestId)}`,
        );
        await reloadDeletionReceipt(payload.requestId);
        if (payload.status === "BLOCKED_BY_LEGAL_HOLD") {
          setMessage(copy.deletionRequestRecorded);
          return;
        }

        window.dispatchEvent(new Event(RECRUITER_AUTHORITY_CHANGED_EVENT));
        const remainingCompanies = companies.filter(
          (candidate) => candidate.id !== selectedCompany.id,
        );
        const nextCompany = remainingCompanies[0] ?? null;
        setCompanies(remainingCompanies);
        setCompany(nextCompany);
        setExplicitCompanyId(nextCompany?.id ?? null);
        setCompanyId(nextCompany?.id ?? ALL_RECRUITER_COMPANIES);
        setForm(nextCompany ? formFromCompany(nextCompany) : emptyForm());
        setIsEditing(nextCompany ? !nextCompany.profileComplete : false);
        setMessage(copy.deletionRequestRecorded);
        return;
      }
      if (!response.ok || !payload.deleted) {
        throw new Error(copy.unableToDelete);
      }

      window.dispatchEvent(new Event(RECRUITER_AUTHORITY_CHANGED_EVENT));

      const remainingCompanies = companies.filter(
        (candidate) => candidate.id !== selectedCompany.id,
      );
      const nextCompany = remainingCompanies[0] ?? null;
      setCompanies(remainingCompanies);
      setCompany(nextCompany);
      setExplicitCompanyId(nextCompany?.id ?? null);
      setCompanyId(nextCompany?.id ?? ALL_RECRUITER_COMPANIES);
      setForm(nextCompany ? formFromCompany(nextCompany) : emptyForm());
      setIsEditing(nextCompany ? !nextCompany.profileComplete : false);
      setDeleteDialogOpen(false);
      setDeleteConfirmation("");
      setMessage(nextCompany ? copy.companyDeleted : "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.unableToDelete);
    } finally {
      setDeleteBusy(false);
    }
  }

  const deletionReceiptPanel = deletionRequestId ? (
    <section
      className={styles.gateCard}
      aria-labelledby="company-deletion-receipt-title"
      aria-live="polite"
      data-testid="company-deletion-receipt"
    >
      <p className={styles.gateLabel}>{copy.deletionReceiptTitle}</p>
      <h2
        className={styles.gateTitle}
        id="company-deletion-receipt-title"
        ref={deletionReceiptHeadingRef}
        tabIndex={-1}
      >
        {deletionReceipt
          ? copy.deletionStatus[deletionReceipt.status]
          : deletionReceiptError || copy.deletionRequestRecorded}
      </h2>
      <button
        className={styles.btnOutline}
        type="button"
        disabled={deletionReceiptBusy}
        onClick={() => void reloadDeletionReceipt(deletionRequestId)}
      >
        {deletionReceiptBusy ? copy.saving : copy.reloadDeletionStatus}
      </button>
    </section>
  ) : null;

  if (!company) {
    return (
      <section className={styles.wrap}>
        {deletionReceiptPanel}
        <section className={styles.emptySection}>
          <p className={styles.eyebrow}>{copy.settings}</p>
          <h1>{copy.noCompanyTitle}</h1>
          <p>{copy.noCompanyDescription}</p>
          <Link
            className={styles.btnSave}
            href="/dashboard/employer-verification"
          >
            {copy.createCompany}
          </Link>
        </section>
      </section>
    );
  }

  const profileValidation = getCompanyProfileValidation(form, locale);
  const missingFields = profileValidation.missingFields;
  const profileComplete = missingFields.length === 0;
  const status = company.verificationStatus;
  const managesSelectedTeam = company.role
    ? company.role === "OWNER"
    : canManageTeam;
  const canDeleteCompany = company.role
    ? company.role === "OWNER"
    : canManageTeam;
  const ownedCompanies = companies.filter(
    (candidate) => candidate.role === "OWNER",
  );
  const ownershipLimitReached =
    ownedCompanies.length >= MAX_OWNED_COMPANIES_PER_USER;

  return (
    <section className={styles.wrap}>
      <div className={styles.phead}>
        <div>
          <p className={styles.eyebrow}>
            <span className={styles.dot} aria-hidden="true" />
            {copy.settings}
          </p>
          <h1 className={styles.ptitle}>{company.name}</h1>
          {company.entityType ? (
            <span className={styles.legalType}>{company.entityType}</span>
          ) : null}
          <p className={styles.psub}>{copy.keepIdentityUpToDate}</p>
        </div>
        <div className={styles.headerActions}>
          <span className={statusClass(status)}>
            <span aria-hidden="true">{statusIcon(status)}</span>
            {copy.verification}: {statusLabel(status, copy)}
          </span>
          <Link
            className={styles.createCompanyLink}
            href="/dashboard/employer-verification"
          >
            {copy.addOrJoinCompany}
          </Link>
        </div>
      </div>
      <section
        className={styles.companySwitcher}
        aria-labelledby="company-switcher-title"
      >
        <div className={styles.companySwitcherHeader}>
          <p className={styles.switcherLabel} id="company-switcher-title">
            {copy.yourCompanies}
          </p>
          <span className={styles.companySwitcherSectionCount}>
            {copy.slots(
              ownedCompanies.length,
              MAX_OWNED_COMPANIES_PER_USER,
            )}
          </span>
        </div>
        <div
          className={styles.companySwitcherList}
          role="group"
          aria-label={copy.yourCompanies}
        >
          {companies.map((candidate) => (
            <button
              className={`${styles.companySwitcherItem}${candidate.id === company.id ? ` ${styles.companySwitcherItemActive}` : ""}`}
              type="button"
              key={candidate.id}
              aria-pressed={candidate.id === company.id}
              onClick={() => {
                setExplicitCompanyId(null);
                setCompanyId(candidate.id);
              }}
            >
              <CompanyAvatar
                name={candidate.name}
                imageUrl={candidate.logo}
                size="sm"
              />
              <span className={styles.companySwitcherName}>{candidate.name}</span>
            </button>
          ))}
        </div>
        <p className={styles.companySwitcherNote} role="status">
          {ownershipLimitReached
            ? copy.ownershipLimitReached(MAX_OWNED_COMPANIES_PER_USER)
            : copy.ownershipUsage(
                ownedCompanies.length,
                MAX_OWNED_COMPANIES_PER_USER,
              )}
        </p>
      </section>

      <section
        className={styles.identityCard}
        id="company-settings-content"
      >
        <p className={styles.identityLabel} id="identity-title">
          {copy.verifiedIdentity}
        </p>
        <div className={styles.identityGrid}>
          <div className={styles.lockedField}>
            <label htmlFor="company-identity-name">{copy.companyName}</label>
            <div className={styles.lockedBox} id="company-identity-name">
              <span>{company.name}</span>
              <span
                className={styles.lock}
                role="img"
                aria-label={copy.locked}
              >
                <LockIcon />
              </span>
            </div>
          </div>
          <div className={styles.lockedField}>
            <label htmlFor="company-identity-tax-code">{copy.taxCode}</label>
            <div className={styles.lockedBox} id="company-identity-tax-code">
              <span>{company.taxCode}</span>
              <span
                className={styles.lock}
                role="img"
                aria-label={copy.locked}
              >
                <LockIcon />
              </span>
            </div>
          </div>
        </div>
        <p className={styles.identityNote}>
          {copy.lockedIdentityNote}
          <Link href="/support">{copy.requestSupportChange}</Link>
        </p>
      </section>

      {!profileComplete ? (
        <section
          className={styles.gateCard}
          role="alert"
          aria-labelledby="profile-complete-title"
        >
          <p className={styles.gateLabel}>{copy.postingGate}</p>
          <h2 className={styles.gateTitle} id="profile-complete-title">
            {copy.completeProfileBeforePosting}
          </h2>
          <p className={styles.gateSub}>{copy.postingGateDescription}</p>
          <ul className={styles.gateChecklist}>
            {missingFields.map((field) => (
              <li className={styles.gateItem} key={field}>
                <span className={styles.gi} aria-hidden="true">
                  !
                </span>
                <span>{companyProfileFieldLabel(field, copy)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {deletionReceiptPanel}

      <div className={styles.grid}>
        {isEditing ? (
          <form className={styles.formCard} onSubmit={save} noValidate>
            <p className={styles.formHint}>
              {copy.fieldsRequired} {copy.logoRequired}
            </p>

            <div className={styles.formRow}>
              <div
                className={fieldClass(
                  Boolean(
                    fieldErrors.industry ??
                    profileValidation.fieldErrors.industry,
                  ),
                )}
              >
                <label htmlFor="company-industry">{copy.industry} *</label>
                <input
                  id="company-industry"
                  value={form.industry}
                  onChange={(event) =>
                    updateField("industry", event.target.value)
                  }
                  aria-invalid={Boolean(
                    fieldErrors.industry ??
                    profileValidation.fieldErrors.industry,
                  )}
                  aria-describedby={
                    (fieldErrors.industry ??
                    profileValidation.fieldErrors.industry)
                      ? "company-industry-error"
                      : undefined
                  }
                  placeholder={copy.industryPlaceholder}
                  maxLength={160}
                />
                <FieldError
                  id="company-industry-error"
                  message={
                    fieldErrors.industry ??
                    profileValidation.fieldErrors.industry
                  }
                />
              </div>
              <div
                className={fieldClass(
                  Boolean(
                    fieldErrors.size ?? profileValidation.fieldErrors.size,
                  ),
                )}
              >
                <label htmlFor="company-size">{copy.companySize} *</label>
                <input
                  id="company-size"
                  value={form.size}
                  onChange={(event) => updateField("size", event.target.value)}
                  aria-invalid={Boolean(
                    fieldErrors.size ?? profileValidation.fieldErrors.size,
                  )}
                  aria-describedby={
                    (fieldErrors.size ?? profileValidation.fieldErrors.size)
                      ? "company-size-error"
                      : undefined
                  }
                  placeholder={copy.sizePlaceholder}
                  maxLength={80}
                />
                <FieldError
                  id="company-size-error"
                  message={
                    fieldErrors.size ?? profileValidation.fieldErrors.size
                  }
                />
              </div>
            </div>

            <div className={styles.field}>
              <label htmlFor="company-founded-year">Founded year</label>
              <input
                id="company-founded-year"
                type="number"
                min={1800}
                max={2200}
                value={form.foundedYear ?? ""}
                onChange={(event) =>
                  updateField(
                    "foundedYear",
                    event.target.value ? Number(event.target.value) : null,
                  )
                }
                aria-describedby="company-founded-year-help"
                placeholder="e.g. 2012"
              />
              <p id="company-founded-year-help" className={styles.formHint}>
                Optional public information shown on the Candidate Company page.
              </p>
            </div>

            <div className={styles.field}>
              <label htmlFor="company-website">{copy.website}</label>
              <input
                id="company-website"
                type="url"
                value={form.website ?? ""}
                onChange={(event) =>
                  updateField("website", event.target.value || null)
                }
                aria-invalid={Boolean(fieldErrors.website)}
                aria-describedby={
                  fieldErrors.website ? "company-website-error" : undefined
                }
                placeholder="https://example.com"
              />
              <FieldError
                id="company-website-error"
                message={fieldErrors.website}
              />
            </div>

            <div className={styles.field}>
              <span className={styles.logoLabel}>{copy.logo} *</span>
              <p className={styles.formHint}>{copy.logoHint}</p>
              <div className={styles.logoUpload}>
                <div className={styles.logoPreview}>
                  {form.logo ? (
                    <Image
                      src={form.logo}
                      alt={copy.logoPreview}
                      width={128}
                      height={128}
                      unoptimized
                    />
                  ) : (
                    <span aria-hidden="true">{copy.logo}</span>
                  )}
                </div>
                <div className={styles.logoActions}>
                  <input
                    ref={fileInputRef}
                    id="company-logo-file"
                    className={styles.logoFileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => void selectLogo(event)}
                  />
                  <div className={styles.logoButtons}>
                    <label
                      className={styles.btnOutline}
                      htmlFor="company-logo-file"
                    >
                      {logoBusy
                        ? copy.preparingLogo
                        : form.logo
                          ? copy.chooseAnotherLogo
                          : copy.chooseLogo}
                    </label>
                    <button
                      className={`${styles.btnOutline} ${styles.muted}`}
                      type="button"
                      disabled={!form.logo || logoBusy || busy}
                      onClick={() => updateField("logo", null)}
                    >
                      {copy.removeLogo}
                    </button>
                  </div>
                </div>
              </div>
              <FieldError
                id="company-logo-error"
                message={fieldErrors.logo ?? profileValidation.fieldErrors.logo}
              />
            </div>

            <div
              className={fieldClass(
                Boolean(
                  fieldErrors.address ?? profileValidation.fieldErrors.address,
                ),
              )}
            >
              <label htmlFor="company-address">{copy.address} *</label>
              <input
                id="company-address"
                value={form.address}
                onChange={(event) => updateField("address", event.target.value)}
                aria-invalid={Boolean(
                  fieldErrors.address ?? profileValidation.fieldErrors.address,
                )}
                aria-describedby={
                  (fieldErrors.address ?? profileValidation.fieldErrors.address)
                    ? "company-address-error"
                    : undefined
                }
                placeholder={copy.addressPlaceholder}
                maxLength={300}
              />
              <FieldError
                id="company-address-error"
                message={
                  fieldErrors.address ?? profileValidation.fieldErrors.address
                }
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="company-description">{copy.description}</label>
              <textarea
                ref={descriptionRef}
                id="company-description"
                value={form.description ?? ""}
                onChange={(event) => {
                  resizeDescription(event.currentTarget);
                  updateField("description", event.target.value || null);
                }}
                placeholder={
                  locale === "vi"
                    ? "Giới thiệu ngắn gọn về công ty…"
                    : "Introduce your company briefly..."
                }
                maxLength={3000}
                rows={5}
              />
            </div>

            <div className={styles.formActions}>
              <p
                className={`${styles.formStatus}${error ? ` ${styles.isError}` : ""}`}
                role={error ? "alert" : "status"}
                aria-live="polite"
              >
                {error || message}
              </p>
              <button
                className={styles.btnSave}
                type="submit"
                disabled={busy || logoBusy}
              >
                {busy ? copy.saving : copy.saveProfile}
              </button>
            </div>
          </form>
        ) : (
          <section
            className={styles.formCard}
            aria-labelledby="company-profile-summary-title"
          >
            <div className={styles.readonlyHeader}>
              <div>
                <p className={styles.formHint}>{copy.savedProfile}</p>
                <h2
                  className={styles.readonlyTitle}
                  id="company-profile-summary-title"
                >
                  {copy.publicCompanyInfo}
                </h2>
              </div>
              <span className={styles.savedBadge}>{copy.saved}</span>
            </div>

            <div className={styles.readonlyGrid}>
              <div className={styles.readonlyItem}>
                <span className={styles.readonlyLabel}>{copy.industry}</span>
                <span className={styles.readonlyValue}>
                  {company.industry || copy.notProvided}
                </span>
              </div>
              <div className={styles.readonlyItem}>
                <span className={styles.readonlyLabel}>{copy.companySize}</span>
                <span className={styles.readonlyValue}>
                  {company.size || copy.notProvided}
                </span>
              </div>
              <div className={styles.readonlyItem}>
                <span className={styles.readonlyLabel}>Founded year</span>
                <span className={styles.readonlyValue}>
                  {company.foundedYear ?? "Not provided"}
                </span>
              </div>
              <div className={styles.readonlyItem}>
                <span className={styles.readonlyLabel}>{copy.website}</span>
                <span className={styles.readonlyValue}>
                  {company.website || copy.notProvided}
                </span>
              </div>
              <div className={styles.readonlyItem}>
                <span className={styles.readonlyLabel}>{copy.address}</span>
                <span className={styles.readonlyValue}>
                  {company.address || copy.notProvided}
                </span>
              </div>
              <div className={styles.readonlyItem}>
                <span className={styles.readonlyLabel}>{copy.logo}</span>
                <div className={styles.readonlyLogo}>
                  {company.logo ? (
                    <Image
                      src={company.logo}
                      alt={copy.logo}
                      width={64}
                      height={64}
                      unoptimized
                    />
                  ) : (
                    <span>{copy.logo}</span>
                  )}
                </div>
              </div>
              <div className={`${styles.readonlyItem} ${styles.readonlyWide}`}>
                <span className={styles.readonlyLabel}>{copy.description}</span>
                <span className={styles.readonlyValue}>
                  {company.description || copy.notProvided}
                </span>
              </div>
            </div>

            <div className={styles.readonlyActions}>
              <p
                className={`${styles.formStatus}${error ? ` ${styles.isError}` : ""}`}
                role={error ? "alert" : "status"}
                aria-live="polite"
              >
                {error || message || copy.readOnlyNote}
              </p>
              <button
                className={styles.btnEdit}
                type="button"
                onClick={() => {
                  setIsEditing(true);
                  setMessage("");
                  setError("");
                  setFieldErrors({});
                }}
              >
                {copy.editProfile}
              </button>
            </div>
          </section>
        )}

        <aside className={styles.sideCard}>
          <div>
            <p className={styles.sideLabel}>{copy.ownership}</p>
            <h2 className={styles.sideTitle}>{copy.memberAccess}</h2>
            <p className={styles.sideDesc}>{copy.ownershipDescription}</p>
          </div>

          <div className={styles.sideRow}>
            <div className={styles.srl}>{copy.role.owner}</div>
            <div className={styles.srv}>
              {company.ownerUserId ? copy.authorizedOwner : copy.unclaimed}
            </div>
          </div>
          <div className={styles.sideRow}>
            <div className={styles.srl}>{copy.members}</div>
            <div className={styles.srv}>{company.memberUserIds.length}</div>
          </div>
          {managesSelectedTeam ? (
            <div className={styles.sideActions}>
              <Link
                className={styles.btnOutline}
                href={`/recruiter/company-settings/team?companyId=${encodeURIComponent(company.databaseId ?? company.id)}`}
              >
                {teamCopy.manageTeam}
              </Link>
              <Link
                className={styles.btnOutline}
                href={`/recruiter/company-settings/team/applications?companyId=${encodeURIComponent(company.databaseId ?? company.id)}`}
              >
                {teamCopy.teamApplications}
              </Link>
            </div>
          ) : (
            <p className={styles.sideNote}>{copy.activeOwnerOnly}</p>
          )}
          {canDeleteCompany ? (
            <div className={styles.dangerZone}>
              <p className={styles.dangerLabel}>{copy.dangerZone}</p>
              <p className={styles.dangerText}>{copy.dangerDescription}</p>
              <button
                className={styles.btnDelete}
                type="button"
                disabled={busy || logoBusy || deleteBusy}
                onClick={openDeleteDialog}
              >
                {copy.deleteCompany}
              </button>
            </div>
          ) : null}
        </aside>
      </div>
      {deleteDialogOpen ? (
        <div
          className={styles.deleteDialogBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDeleteDialog();
          }}
        >
          <section
            className={styles.deleteDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-company-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.deleteDialogHeader}>
              <div>
                <p className={styles.dangerLabel}>{copy.dangerZone}</p>
                <h2 id="delete-company-title">
                  {locale === "vi"
                    ? `Xóa ${company.name}?`
                    : `Delete ${company.name}?`}
                </h2>
              </div>
              <button
                className={styles.deleteDialogClose}
                type="button"
                aria-label={copy.closeDeleteDialog}
                disabled={deleteBusy}
                onClick={closeDeleteDialog}
              >
                ×
              </button>
            </div>
            <p className={styles.deleteDialogText}>
              {copy.deleteDialogDescription}
            </p>
            <label className={styles.deleteConfirmationLabel}>
              {locale === "vi" ? "Nhập " : "Type "}
              <strong>{company.name}</strong>
              {` ${copy.typeToConfirm}`}
              <input
                ref={deleteConfirmationRef}
                className={styles.deleteConfirmationInput}
                type="text"
                value={deleteConfirmation}
                aria-label={
                  locale === "vi"
                    ? `Nhập tên công ty ${copy.typeToConfirm}`
                    : `Type company name ${copy.typeToConfirm}`
                }
                autoComplete="off"
                disabled={deleteBusy}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
              />
            </label>
            <div className={styles.deleteDialogActions}>
              <button
                className={styles.btnCancelDelete}
                type="button"
                disabled={deleteBusy}
                onClick={closeDeleteDialog}
              >
                {copy.cancel}
              </button>
              <button
                className={styles.btnDeleteConfirm}
                type="button"
                disabled={
                  deleteBusy ||
                  deleteConfirmation.trim() !== company.name.trim()
                }
                onClick={() => void deleteCompany()}
              >
                {deleteBusy ? copy.deleting : copy.deleteCompany}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
