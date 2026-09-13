import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "react-email";
import { z } from "zod";

export const recruitmentNotificationEmailPayloadSchema = z
  .object({
    v: z.literal(1),
    audience: z.enum(["CANDIDATE", "COMPANY"]),
    notificationKind: z.enum([
      "APPLICATION_SUBMITTED",
      "APPLICATION_RECEIVED",
      "APPLICATION_STAGE_CHANGED",
    ]),
    applicationId: z.string().trim().min(1).max(128),
    jobId: z.string().trim().min(1).max(128),
    jobTitle: z.string().trim().min(1).max(240),
    companyName: z.string().trim().min(1).max(240),
    stage: z.string().trim().min(1).max(80).optional(),
    applicationUrl: z.string().url().max(2048),
  })
  .strict();

export type RecruitmentNotificationEmailPayload = z.infer<
  typeof recruitmentNotificationEmailPayloadSchema
>;

function notificationCopy(payload: RecruitmentNotificationEmailPayload) {
  if (payload.notificationKind === "APPLICATION_SUBMITTED") {
    return {
      subject: "Application submitted",
      heading: "Your application was submitted",
      message:
        "Your application was submitted successfully. You can return to NextGen Careers to review its current status.",
      button: "View application",
    };
  }
  if (payload.notificationKind === "APPLICATION_RECEIVED") {
    return {
      subject: "New application received",
      heading: "A new application was received",
      message:
        "A candidate submitted an application for this job. Open the recruiter workspace to review the application.",
      button: "Open recruiter workspace",
    };
  }
  return {
    subject: "Application stage updated",
    heading: "An application stage was updated",
    message: payload.stage
      ? `The application is now ${payload.stage}. Open the current application record to review the update.`
      : "The application stage changed. Open the current application record to review the update.",
    button: "View application",
  };
}

export function RecruitmentNotificationTemplate(
  payload: RecruitmentNotificationEmailPayload,
) {
  const copy = notificationCopy(payload);
  return (
    <Html>
      <Head />
      <Preview>
        {copy.subject}: {payload.jobTitle}
      </Preview>
      <Body
        style={{ backgroundColor: "#f8fafc", fontFamily: "Arial, sans-serif" }}
      >
        <Container
          style={{
            backgroundColor: "#fff",
            margin: "32px auto",
            padding: "32px",
            maxWidth: "560px",
          }}
        >
          <Heading>{copy.heading}</Heading>
          <Text>
            <strong>{payload.jobTitle}</strong> at {payload.companyName}
          </Text>
          <Text>{copy.message}</Text>
          <Button
            href={payload.applicationUrl}
            style={{
              backgroundColor: "#2457d6",
              borderRadius: "8px",
              color: "#fff",
              display: "inline-block",
              padding: "12px 18px",
              textDecoration: "none",
            }}
          >
            {copy.button}
          </Button>
        </Container>
      </Body>
    </Html>
  );
}

export function recruitmentNotificationEmailText(
  payload: RecruitmentNotificationEmailPayload,
) {
  const copy = notificationCopy(payload);
  return `${copy.heading}\n\n${payload.jobTitle} at ${payload.companyName}\n${copy.message}\n\n${copy.button}: ${payload.applicationUrl}`;
}
