"use client";

import { cloneElement, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import {
  registrationSchema,
  type RegistrationInput,
} from "@/shared/contracts/identity/registration";
import { useWorkspaceLocale } from "@/frontend/features/dashboard/client/workspace-locale";
import { PasswordField } from "./password-field";
import { PasswordRequirementChecklist } from "./password-requirement-checklist";
import {
  authCopy,
  localizedAuthFieldError,
  localizedAuthMessage,
} from "./auth-copy";

export function RegisterForm() {
  const router = useRouter();
  const locale = useWorkspaceLocale();
  const copy = authCopy(locale);
  const [serverStatus, setServerStatus] = useState("");
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<RegistrationInput>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      passwordConfirmation: "",
    },
  });
  const password = useWatch({ control, name: "password", defaultValue: "" });
  const submit = handleSubmit(async (values) => {
    setServerStatus("");
    try {
      const response = await fetch("/api/identity/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = (await response.json().catch(() => null)) as {
        message?: string;
        fields?: Record<string, string[]>;
      } | null;
      if (!response.ok) {
        const fieldEntries = Object.entries(body?.fields ?? {});
        for (const [field, messages] of fieldEntries)
          setError(field as keyof RegistrationInput, { message: messages[0] });
        setServerStatus(
          fieldEntries.length === 0
            ? localizedAuthMessage(
                locale,
                body?.message,
                copy.register.registrationError,
              )
            : "",
        );
        toast.error(copy.register.registrationAttention);
        return;
      }
      const email = values.email.trim().toLowerCase();
      sessionStorage.setItem("pending_verification_email", email);
      toast.success(copy.register.checkEmail);
      router.push(`/check-email?email=${encodeURIComponent(email)}`);
    } catch {
      setServerStatus(copy.register.registrationError);
      toast.error(copy.register.registrationAttention);
    }
  });
  return (
    <form
      className="auth-form"
      onSubmit={submit}
      noValidate
      aria-busy={isSubmitting}
    >
      <div className="auth-form-heading">
        <p className="form-kicker">{copy.register.kicker}</p>
        <h1>{copy.register.title}</h1>
        <p>{copy.register.description}</p>
      </div>
      <Field
        label={copy.register.fullName}
        error={localizedAuthFieldError(locale, "name", errors.name?.message)}
      >
        <input autoComplete="name" {...register("name")} />
      </Field>
      <Field
        label={copy.common.emailAddress}
        error={localizedAuthFieldError(locale, "email", errors.email?.message)}
      >
        <input
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={copy.common.emailPlaceholder}
          {...register("email")}
        />
      </Field>
      <PasswordField
        label={copy.register.password}
        error={localizedAuthFieldError(
          locale,
          "password",
          errors.password?.message,
        )}
        autoComplete="new-password"
        {...register("password")}
      />
      <PasswordRequirementChecklist value={password} />
      <PasswordField
        label={copy.register.confirmPassword}
        error={localizedAuthFieldError(
          locale,
          "passwordConfirmation",
          errors.passwordConfirmation?.message,
        )}
        autoComplete="new-password"
        {...register("passwordConfirmation")}
      />
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? copy.register.creating : copy.register.create}
      </button>
      {serverStatus && <p role="alert">{serverStatus}</p>}
      <div role="status" aria-live="polite">
        {isSubmitting ? copy.register.submitting : ""}
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactElement<Record<string, unknown>>;
}) {
  const id = label.toLowerCase().replaceAll(" ", "-");
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, {
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": error ? `${id}-error` : undefined,
      })}
      {error && (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
