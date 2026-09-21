import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecruiterJobPostingManagement } from "@/frontend/features/recruiter-workspace/job-posting-management";
import { CsrfProofProvider } from "@/frontend/features/authentication/client/csrf-proof-context";
import type { RecruiterJobManagementData } from "@/shared/contracts/recruiter-job-posting";

const initialData: RecruiterJobManagementData = {
  companyId: "company-1",
  recruiterUserId: "recruiter-1",
  companies: [
    {
      id: "company-1",
      slug: "northstar-labs",
      name: "Northstar Labs",
      logo: null,
      size: "51-200 employees",
      industry: "Information Technology (IT)",
      address: "Ho Chi Minh City",
      website: null,
      description: "A product company.",
      ownerUserId: "recruiter-1",
    },
  ],
  jobs: [
    {
      id: "job-1",
      slug: "senior-product-designer-job-1",
      companyId: "company-1",
      title: "Senior Product Designer",
      shortPitch: "Design the next generation of hiring tools.",
      industry: "Information Technology (IT)",
      industryCode: "r03",
      subIndustry: "Software Development",
      categoryIds: ["r03-software-development"],
      categoryFamily: "r03",
      skillTags: ["Figma", "Product design"],
      location: {
        city: "Ho Chi Minh City",
        district: "District 1",
        isNationwideRemote: false,
      },
      salary: {
        min: 45_000_000,
        max: 65_000_000,
        currency: "VND",
        period: "month",
        isNegotiable: false,
      },
      experience: { minYears: 5, label: "5+ years" },
      level: "senior",
      employmentType: "full_time",
      workArrangement: "hybrid",
      workOnSaturday: false,
      education: "Bachelor's degree",
      age: "",
      numberOfHires: 1,
      status: "active",
      isUrgent: false,
      isVerified: true,
      postedAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:00.000Z",
      applyDeadline: "2026-09-14T00:00:00.000Z",
      description: {
        overview: "Shape thoughtful experiences for hiring teams.",
        topReasonsToJoin: [],
        responsibilities: ["Own end-to-end product design."],
        requirements: ["Strong product design experience."],
        benefits: [],
        generalInfo: {
          reportsTo: null,
          department: "Software Development",
          workingHours: null,
          workAddress: null,
        },
      },
      stats: { viewCount: 100, applicantCount: 48 },
      company: {
        id: "company-1",
        slug: "northstar-labs",
        name: "Northstar Labs",
        logo: null,
        size: "51-200 employees",
        industry: "Information Technology (IT)",
        address: "Ho Chi Minh City",
        website: null,
        description: "A product company.",
        ownerUserId: "recruiter-1",
      },
    },
  ],
};

describe("recruiter job posting management", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("uses the stable job id when opening candidates from a routed workspace", () => {
    const onNavigate = vi.fn();
    render(
      <RecruiterJobPostingManagement
        initialData={initialData}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /48 Applicants/ }));

    expect(onNavigate).toHaveBeenCalledWith("/recruiter/candidates/job-1");
  });

  it("shows live overview metrics and opens the structured editor", () => {
    render(
      <CsrfProofProvider value="csrf-proof">
        <RecruiterJobPostingManagement initialData={initialData} />
      </CsrfProofProvider>,
    );

    expect(screen.getByText("Active jobs")).toBeVisible();
    expect(screen.getByText("Total applicants")).toBeVisible();
    expect(screen.getByRole("tab", { name: /Active1/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: /48 Applicants/ })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Edit job posting/ }));

    expect(
      screen.getByRole("heading", {
        name: "Senior Product Designer",
        level: 1,
      }),
    ).toBeVisible();
    expect(screen.getByText("Live candidate preview")).toBeVisible();
    expect(screen.getByText("Required skills")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeVisible();
    expect(screen.queryByLabelText("Department")).toBeNull();
    const autoSaveSwitch = screen.getByRole("switch", {
      name: "Automatic save: Off",
    });
    expect(autoSaveSwitch).toHaveAttribute("aria-checked", "false");
    expect(within(autoSaveSwitch).getByText("AutoSave")).toBeVisible();
    expect(within(autoSaveSwitch).getByText("Off")).toBeVisible();
    expect(screen.queryByText("Drafts are saved manually")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });

  it("scopes postings and the create route to the selected company", () => {
    const secondCompany = {
      ...initialData.companies[0],
      id: "company-2",
      slug: "northstar-analytics",
      name: "Northstar Analytics",
    };
    const secondJob = {
      ...initialData.jobs[0],
      id: "job-2",
      slug: "backend-engineer-job-2",
      companyId: secondCompany.id,
      title: "Backend Engineer",
      company: secondCompany,
    };
    const onNavigate = vi.fn();

    render(
      <RecruiterJobPostingManagement
        initialData={{
          ...initialData,
          companies: [initialData.companies[0], secondCompany],
          jobs: [initialData.jobs[0], secondJob],
        }}
        onNavigate={onNavigate}
      />,
    );

    const companyFilter = screen.getByLabelText("Company");
    expect(companyFilter).toHaveValue("all");
    expect(screen.getByText("Senior Product Designer")).toBeVisible();
    expect(screen.getByText("Backend Engineer")).toBeVisible();

    fireEvent.change(companyFilter, { target: { value: "company-2" } });

    expect(screen.queryByText("Senior Product Designer")).toBeNull();
    expect(screen.getByText("Backend Engineer")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create job posting" }));
    expect(onNavigate).toHaveBeenCalledWith(
      "/recruiter/job-postings/create?companyId=company-2",
    );
  });

  it("hides the company filter when only one company is available", () => {
    render(<RecruiterJobPostingManagement initialData={initialData} />);

    expect(screen.queryByLabelText("Company")).not.toBeInTheDocument();
  });

  it("automatically reflects an administrator approval without a page refresh", async () => {
    vi.useFakeTimers();
    const pendingData: RecruiterJobManagementData = {
      ...initialData,
      jobs: [{ ...initialData.jobs[0], status: "pending_approval" }],
    };
    const approvedData: RecruiterJobManagementData = {
      ...pendingData,
      jobs: [{ ...pendingData.jobs[0], status: "active" }],
    };
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify(approvedData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<RecruiterJobPostingManagement initialData={pendingData} />);
    expect(
      screen.queryByRole("heading", {
        name: "Senior Product Designer",
        level: 2,
      }),
    ).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    const card = screen.getByRole("article", {
      name: "Senior Product Designer",
    });
    expect(within(card).getByText("Active")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith("/api/recruiter/job-postings", {
      cache: "no-store",
    });
  });

  it("blocks submission and identifies missing required fields", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<RecruiterJobPostingManagement initialData={initialData} />);

    fireEvent.click(screen.getByRole("button", { name: "Create job posting" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Submit for approval" }),
    );

    expect(screen.getByText("Enter a job title.")).toBeVisible();
    expect(screen.getByText("Add a short pitch.")).toBeVisible();
    expect(screen.getByText("Add a role overview.")).toBeVisible();
    expect(screen.getByText("Choose an application deadline.")).toBeVisible();
    expect(
      screen.queryByText(
        "Review the highlighted fields before saving this posting.",
      ),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits a complete posting with a populated sub-industry", async () => {
    const createdJob = {
      ...initialData.jobs[0],
      id: "job-created",
      title: "Frontend Engineer",
      subIndustry: "Software Development",
      status: "draft" as const,
    };
    const review = {
      reviewId: "review-created",
      jobId: "job-created",
      sequence: 1,
      state: "PENDING_REVIEW" as const,
      readOnly: true,
      submittedAt: "2026-08-18T00:00:00.000Z",
      version: 1,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(createdJob), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(review), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CsrfProofProvider value="csrf-proof">
        <RecruiterJobPostingManagement initialData={initialData} />
      </CsrfProofProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create job posting" }));
    fireEvent.change(screen.getByLabelText(/Job title/), {
      target: { value: "Frontend Engineer" },
    });
    fireEvent.change(screen.getByLabelText(/Short pitch/), {
      target: { value: "Build reliable candidate experiences." },
    });
    fireEvent.change(screen.getByLabelText(/Sub-industry/), {
      target: { value: "Software Development" },
    });
    fireEvent.change(screen.getByLabelText(/Overview/), {
      target: {
        value: "Own the frontend experience from discovery to delivery.",
      },
    });
    fireEvent.change(screen.getByLabelText(/Responsibilities/), {
      target: {
        value: "Own the frontend experience from discovery to delivery.",
      },
    });
    fireEvent.change(screen.getByLabelText(/Requirements/), {
      target: { value: "Strong frontend engineering experience." },
    });
    fireEvent.change(screen.getByLabelText(/Application deadline/), {
      target: { value: "2099-12-31" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Submit for approval" }),
    );
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Submit job for approval?" }),
      ).getByRole("button", { name: "Submit for approval" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as {
      status: string;
      job: { subIndustry: string };
    };
    expect(payload.status).toBe("draft");
    expect(payload.job.subIndustry).toBe("Software Development");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/recruiter/job-postings");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/recruiter/job-postings/job-created/submit-review",
    );
    const reviewRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const reviewPayload = JSON.parse(String(reviewRequest.body)) as {
      expectedWorkingUpdatedAt: string;
      expectedCatalogueUpdatedAt: string;
    };
    expect(reviewPayload.expectedWorkingUpdatedAt).toBe(createdJob.updatedAt);
    expect(reviewPayload.expectedCatalogueUpdatedAt).toBe(createdJob.updatedAt);
    expect(
      screen.getByRole("tab", { name: /Pending approval1/ }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("offers existing Other sub-industries and accepts a new value", () => {
    const otherJob = {
      ...initialData.jobs[0],
      id: "job-other",
      industry: "Other",
      industryCode: "r29",
      categoryFamily: "r29",
      categoryIds: ["r29-aerospace-operations"],
      subIndustry: "Aerospace Operations",
    };
    render(
      <RecruiterJobPostingManagement
        initialData={{ ...initialData, jobs: [otherJob, ...initialData.jobs] }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create job posting" }));
    fireEvent.change(screen.getByLabelText("Industry *"), {
      target: { value: "r29" },
    });

    const subIndustry = screen.getByLabelText("Sub-industry *");
    expect(
      within(subIndustry).getByRole("option", {
        name: "Aerospace Operations",
      }),
    ).toBeVisible();
    fireEvent.change(subIndustry, {
      target: { value: "__custom_sub_industry__" },
    });
    fireEvent.change(screen.getByLabelText("New sub-industry *"), {
      target: { value: "Space Tourism" },
    });

    expect(screen.getByLabelText("New sub-industry *")).toHaveValue(
      "Space Tourism",
    );
  });

  it("quickly saves incomplete drafts and remembers the setting for the next job", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_url: string, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          job: (typeof initialData.jobs)[0];
        };
        return new Response(
          JSON.stringify({
            ...request.job,
            id: "job-auto-saved",
            slug: "platform-engineer-job-auto-saved",
            status: "draft",
            updatedAt: "2026-08-25T10:00:00.000Z",
            company: initialData.companies[0],
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          },
        );
      });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CsrfProofProvider value="csrf-proof">
        <RecruiterJobPostingManagement initialData={initialData} />
      </CsrfProofProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create job posting" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Submit for approval" }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("switch", { name: "Automatic save: Off" }),
    );
    fireEvent.change(screen.getByLabelText(/Job title/), {
      target: { value: "Platform Engineer" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("switch", { name: "Automatic save: On" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("heading", { name: "Platform Engineer", level: 1 }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("tab", { name: /Drafts1/ }));
    expect(
      screen.getByRole("heading", { name: "Platform Engineer", level: 2 }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create job posting" }));
    expect(
      screen.getByRole("switch", { name: "Automatic save: On" }),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("switch", { name: "Automatic save: On" }));
    expect(
      screen.getByRole("switch", { name: "Automatic save: Off" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("does not let an older refresh overwrite an automatic draft response", async () => {
    vi.useFakeTimers();
    let resolveRefresh: ((response: Response) => void) | undefined;
    const savedTitle = "Updated title from AutoSave";
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveRefresh = resolve;
          }),
      )
      .mockImplementation(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          job: (typeof initialData.jobs)[0];
        };
        return new Response(
          JSON.stringify({
            ...body.job,
            id: "job-auto-refresh",
            slug: "updated-title-auto-refresh",
            title: savedTitle,
            status: "draft",
            company: initialData.companies[0],
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          },
        );
      });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CsrfProofProvider value="csrf-proof">
        <RecruiterJobPostingManagement initialData={initialData} />
      </CsrfProofProvider>,
    );

    window.dispatchEvent(new Event("focus"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Create job posting" }));
    fireEvent.click(
      screen.getByRole("switch", { name: "Automatic save: Off" }),
    );
    fireEvent.change(screen.getByLabelText(/Job title/), {
      target: { value: savedTitle },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolveRefresh?.(
      new Response(JSON.stringify(initialData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("tab", { name: /Drafts1/ }));
    expect(
      screen.getByRole("heading", { name: savedTitle, level: 2 }),
    ).toBeVisible();
  });

  it("flushes an incomplete automatic draft immediately when the page is hidden", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_url: string, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          job: (typeof initialData.jobs)[0];
        };
        return new Response(
          JSON.stringify({
            ...request.job,
            id: "job-pagehide-draft",
            slug: "untitled-job-remote-pagehide",
            status: "draft",
            updatedAt: "2026-08-25T10:00:00.000Z",
            company: initialData.companies[0],
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          },
        );
      });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CsrfProofProvider value="csrf-proof">
        <RecruiterJobPostingManagement initialData={initialData} />
      </CsrfProofProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create job posting" }));
    fireEvent.click(
      screen.getByRole("switch", { name: "Automatic save: Off" }),
    );
    fireEvent.change(screen.getByLabelText(/Short pitch/), {
      target: { value: "A partially written posting." },
    });

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recruiter/job-postings",
      expect.objectContaining({ keepalive: true }),
    );
  });

  it("does not wait for the draft response before leaving the editor", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => {
      void _url;
      void _init;
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CsrfProofProvider value="csrf-proof">
        <RecruiterJobPostingManagement initialData={initialData} />
      </CsrfProofProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create job posting" }));
    fireEvent.click(
      screen.getByRole("switch", { name: "Automatic save: Off" }),
    );
    fireEvent.change(screen.getByLabelText(/Job title/), {
      target: { value: "Unfinished role" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.getByRole("button", { name: "Create job posting" }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recruiter/job-postings",
      expect.objectContaining({ keepalive: true }),
    );

    resolveFetch?.(
      new Response(
        JSON.stringify({
          ...initialData.jobs[0],
          id: "job-background-draft",
          slug: "unfinished-role-remote-background",
          title: "Unfinished role",
          status: "draft",
          company: initialData.companies[0],
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("flushes an edited industry's partition hint when leaving the editor", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      void url;
      void init;
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CsrfProofProvider value="csrf-proof">
        <RecruiterJobPostingManagement initialData={initialData} />
      </CsrfProofProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Edit job posting/ }));
    fireEvent.click(
      screen.getByRole("switch", { name: "Automatic save: Off" }),
    );
    fireEvent.change(screen.getByLabelText("Industry *"), {
      target: { value: "r04" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as {
      industryCode: string;
      previousIndustryCode: string;
      status: string;
    };
    expect(payload).toMatchObject({
      industryCode: "r04",
      previousIndustryCode: "r03",
      status: "draft",
    });
    expect(request.keepalive).toBe(true);
    expect(
      screen.getByRole("button", { name: "Create job posting" }),
    ).toBeVisible();

    resolveFetch?.(
      new Response(
        JSON.stringify({
          ...initialData.jobs[0],
          industry: "Accounting / Auditing",
          industryCode: "r04",
          subIndustry: "",
          status: "draft",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("warns before unloading while job changes are still unsaved", () => {
    render(<RecruiterJobPostingManagement initialData={initialData} />);
    fireEvent.click(screen.getByRole("button", { name: "Create job posting" }));
    fireEvent.change(screen.getByLabelText(/Job title/), {
      target: { value: "Unfinished role" },
    });

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("preserves spaces and commas while editing skills", async () => {
    const editableJob = {
      ...initialData.jobs[0],
      applyDeadline: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(editableJob), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <RecruiterJobPostingManagement
        initialData={{ ...initialData, jobs: [editableJob] }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Edit job posting/ }));
    const skills = screen.getByPlaceholderText(
      "React, TypeScript, Product design",
    );

    fireEvent.change(skills, { target: { value: "React Native " } });
    expect(skills).toHaveValue("React Native ");
    fireEvent.change(skills, {
      target: { value: "React Native, TypeScript, Product design" },
    });
    expect(skills).toHaveValue("React Native, TypeScript, Product design");

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as {
      skillTags: string[];
    };
    expect(payload.skillTags).toEqual([
      "React Native",
      "TypeScript",
      "Product design",
    ]);
  });

  it("does not crash when the deadline input emits a malformed date", () => {
    render(<RecruiterJobPostingManagement initialData={initialData} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit job posting/ }));

    const deadline = screen.getByLabelText(/Application deadline/);
    expect(() =>
      fireEvent.change(deadline, { target: { value: "25/08/2026" } }),
    ).not.toThrow();
  });

  it("disables creation when no recruiter-owned company is linked", () => {
    render(
      <RecruiterJobPostingManagement
        initialData={{ jobs: [], companies: [], companyId: null }}
      />,
    );

    expect(screen.getByText("Company setup required")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create job posting" }),
    ).toBeDisabled();
  });

  it("guides recruiters to the missing company-profile fields before posting", () => {
    render(
      <RecruiterJobPostingManagement
        initialData={{
          ...initialData,
          companyProfileComplete: false,
          missingCompanyProfileFields: ["industry", "address"],
        }}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Complete company profile before posting",
      }),
    ).toBeVisible();
    expect(screen.getByText("Action required")).toBeVisible();
    expect(screen.getByText("Industry")).toBeVisible();
    expect(screen.getByText("Address")).toBeVisible();
    expect(screen.queryByText("Company logo")).toBeNull();
    expect(
      screen.getByRole("link", { name: /Open company settings/ }),
    ).toHaveAttribute("href", "/recruiter/company-settings?required=profile");
  });
  it("extends a closing-soon active job without closing it", async () => {
    const deadline = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const closingJob = { ...initialData.jobs[0], applyDeadline: deadline };
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const update = JSON.parse(String(init?.body)) as typeof closingJob;
        return new Response(
          JSON.stringify({
            ...closingJob,
            ...update,
            company: closingJob.company,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <RecruiterJobPostingManagement
        initialData={{ ...initialData, jobs: [closingJob] }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Extend deadline" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as {
      status: string;
      applyDeadline: string;
    };
    expect(request.method).toBe("PATCH");
    expect(payload.status).toBe("active");
    expect(new Date(payload.applyDeadline).getTime()).toBeGreaterThan(
      new Date(deadline).getTime(),
    );
    expect(screen.getByRole("button", { name: "Close early" })).toBeVisible();
  });

  it("confirms closing an active job and lets the recruiter cancel", async () => {
    const closedJob = {
      ...initialData.jobs[0],
      status: "closed" as const,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(closedJob), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CsrfProofProvider value="csrf-proof">
        <RecruiterJobPostingManagement initialData={initialData} />
      </CsrfProofProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close early" }));

    const dialog = screen.getByRole("dialog", { name: "Close job early?" });
    expect(
      within(dialog).getByText(/stop accepting new applications/i),
    ).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("dialog", { name: "Close job early?" }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close early" }));
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Close job early?" }),
      ).getByRole("button", { name: "Close job" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recruiter/job-postings?jobId=job-1&industryCode=r03",
      {
        method: "DELETE",
        headers: { "x-csrf-token": "csrf-proof" },
      },
    );
    expect(screen.getByRole("tab", { name: /Closed1/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      within(
        screen.getByRole("article", { name: "Senior Product Designer" }),
      ).getByText("Closed"),
    ).toBeVisible();
  });

  it("reactivates a closed job only after confirmation", async () => {
    const closedJob = {
      ...initialData.jobs[0],
      status: "closed" as const,
    };
    const activeJob = { ...closedJob, status: "active" as const };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(activeJob), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CsrfProofProvider value="csrf-proof">
        <RecruiterJobPostingManagement
          initialData={{ ...initialData, jobs: [closedJob] }}
          initialTab="closed"
        />
      </CsrfProofProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reactivate job" }));

    const dialog = screen.getByRole("dialog", { name: "Reactivate job?" });
    expect(
      within(dialog).getByText(/start accepting new applications again/i),
    ).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("dialog", { name: "Reactivate job?" }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reactivate job" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Reactivate job?" })).getByRole(
        "button",
        { name: "Reactivate job" },
      ),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recruiter/job-postings/job-1/reactivate?industryCode=r03",
      {
        method: "POST",
        headers: { "x-csrf-token": "csrf-proof" },
      },
    );
    expect(screen.getByRole("tab", { name: /Active1/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: "Close early" })).toBeVisible();
  });

  it("opens a closed posting as view-only without saving or reactivating it", () => {
    const closedJob = {
      ...initialData.jobs[0],
      status: "closed" as const,
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <RecruiterJobPostingManagement
        initialData={{ ...initialData, jobs: [closedJob] }}
        initialTab="closed"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "View closed job posting: Senior Product Designer",
      }),
    );

    expect(screen.getByText("Closed posting — view only")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.getByLabelText(/Job title/)).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("soft-deletes an active job after confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jobId: "job-1", deleted: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CsrfProofProvider value="csrf-proof">
        <RecruiterJobPostingManagement initialData={initialData} />
      </CsrfProofProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete job" }));

    const dialog = screen.getByRole("dialog", { name: "Delete active job?" });
    expect(
      within(dialog).getByText(/removed from the public job data/i),
    ).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete active job" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recruiter/job-postings?jobId=job-1&action=delete&industryCode=r03",
      {
        method: "DELETE",
        headers: { "x-csrf-token": "csrf-proof" },
      },
    );
    await waitFor(() =>
      expect(screen.queryByText("Senior Product Designer")).toBeNull(),
    );
    expect(document.querySelector(".recruiter-toast")).toBeNull();
  });

  it("keeps action failures inside the confirmation dialog without a toast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "JOB_SERVICE_UNAVAILABLE",
            message: "Try again in a moment.",
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    render(
      <CsrfProofProvider value="csrf-proof">
        <RecruiterJobPostingManagement initialData={initialData} />
      </CsrfProofProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete job" }));
    const dialog = screen.getByRole("dialog", { name: "Delete active job?" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete active job" }),
    );

    expect(
      await within(dialog).findByText(
        "Unable to delete this posting right now. Please try again.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("article", { name: "Senior Product Designer" }),
    ).toBeVisible();
    expect(document.querySelector(".recruiter-toast")).toBeNull();
  });

  it("withdraws a pending submission back to Drafts", async () => {
    const pendingJob = {
      ...initialData.jobs[0],
      status: "pending_approval" as const,
    };
    const draftJob = { ...pendingJob, status: "draft" as const };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(draftJob), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CsrfProofProvider value="csrf-proof">
        <RecruiterJobPostingManagement
          initialData={{ ...initialData, jobs: [pendingJob] }}
        />
      </CsrfProofProvider>,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Pending approval1/ }));

    fireEvent.click(screen.getByRole("button", { name: "Withdraw to draft" }));

    const dialog = screen.getByRole("dialog", {
      name: "Withdraw submission?",
    });
    expect(
      within(dialog).getByText(/leave the administrator review queue/i),
    ).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Withdraw to Drafts" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recruiter/job-postings/job-1/withdraw-review?industryCode=r03",
      {
        method: "POST",
        headers: { "x-csrf-token": "csrf-proof" },
      },
    );
    expect(screen.getByRole("tab", { name: /Drafts1/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: "Delete draft" })).toBeVisible();
    expect(document.querySelector(".recruiter-toast")).toBeNull();
  });

  it("persists a withdrawn draft before submitting it again", async () => {
    const withdrawnJob = {
      ...initialData.jobs[0],
      status: "draft" as const,
      applyDeadline: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
      updatedAt: "2026-08-07T00:00:00.000Z",
      review: {
        reviewId: "withdrawn-review-1",
        jobId: "job-1",
        sequence: 1,
        state: "WITHDRAWN" as const,
        readOnly: false,
        reasonCode: null,
        publicExplanation: null,
        submittedAt: "2026-08-07T00:00:00.000Z",
        decidedAt: "2026-08-08T00:00:00.000Z",
        version: 2,
      },
    };
    const refreshedDraft = {
      ...withdrawnJob,
      review: undefined,
      updatedAt: "2026-08-25T03:00:00.000Z",
    };
    const resubmittedReview = {
      reviewId: "review-resubmitted",
      jobId: "job-1",
      sequence: 2,
      state: "PENDING_REVIEW" as const,
      readOnly: true,
      submittedAt: "2026-08-25T03:00:01.000Z",
      version: 3,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(refreshedDraft), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(resubmittedReview), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CsrfProofProvider value="csrf-proof">
        <RecruiterJobPostingManagement
          initialData={{ ...initialData, jobs: [withdrawnJob] }}
        />
      </CsrfProofProvider>,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Drafts1/ }));
    fireEvent.click(screen.getByRole("button", { name: /Edit job posting/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Submit for approval" }),
    );
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Submit job for approval?" }),
      ).getByRole("button", { name: "Submit for approval" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/recruiter/job-postings");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/recruiter/job-postings/job-1/submit-review",
    );
    const submission = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
    ) as {
      expectedWorkingUpdatedAt: string;
      expectedCatalogueUpdatedAt: string;
    };
    expect(submission.expectedWorkingUpdatedAt).toBe(refreshedDraft.updatedAt);
    expect(submission.expectedCatalogueUpdatedAt).toBe(
      refreshedDraft.updatedAt,
    );
  });
  it("provides a progress indicator and independently collapsible sections", () => {
    render(<RecruiterJobPostingManagement initialData={initialData} />);
    fireEvent.click(screen.getByRole("button", { name: "Create job posting" }));

    expect(
      screen.getByRole("progressbar", { name: "Job posting completion" }),
    ).toHaveAttribute("aria-valuemax", "6");
    const basicSummary = screen.getByText("Basic info").closest("summary");
    const locationSummary = screen
      .getByText("Location & work arrangement")
      .closest("summary");
    expect(basicSummary?.parentElement).toHaveAttribute("open");
    expect(locationSummary?.parentElement).toHaveAttribute("open");

    fireEvent.click(basicSummary!);
    expect(basicSummary?.parentElement).not.toHaveAttribute("open");
    expect(locationSummary?.parentElement).toHaveAttribute("open");
  });
  it("formats salary input live, validates the range, and mirrors it in preview", () => {
    render(<RecruiterJobPostingManagement initialData={initialData} />);
    fireEvent.click(screen.getByRole("button", { name: "Create job posting" }));

    const minimum = screen.getByLabelText(/Minimum salary/);
    const maximum = screen.getByLabelText(/Maximum salary/);
    fireEvent.change(minimum, { target: { value: "29000000" } });
    fireEvent.change(maximum, { target: { value: "33000000" } });

    expect(minimum).toHaveValue("29.000.000");
    expect(maximum).toHaveValue("33.000.000");
    expect(screen.getByText("29,000,000 - 33,000,000 VND/month")).toBeVisible();

    fireEvent.change(maximum, { target: { value: "20000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(
      screen.getByText(
        "Maximum salary must be greater than or equal to minimum salary.",
      ),
    ).toBeVisible();
  });

  it("persists the expanded jobs.json fields as structured values", async () => {
    const createdJob = {
      ...initialData.jobs[0],
      id: "job-expanded",
      status: "draft" as const,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(createdJob), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<RecruiterJobPostingManagement initialData={initialData} />);
    fireEvent.click(screen.getByRole("button", { name: "Create job posting" }));

    fireEvent.change(screen.getByLabelText(/Job title/), {
      target: { value: "Platform Engineer" },
    });
    fireEvent.change(screen.getByLabelText(/Short pitch/), {
      target: { value: "Build the foundation for reliable hiring." },
    });
    fireEvent.change(screen.getByLabelText(/Overview/), {
      target: { value: "Own platform reliability and developer experience." },
    });
    fireEvent.change(screen.getByLabelText(/Minimum salary/), {
      target: { value: "29tr" },
    });
    fireEvent.change(screen.getByLabelText(/Maximum salary/), {
      target: { value: "33tr" },
    });
    fireEvent.change(screen.getByLabelText(/Age range/), {
      target: { value: "24-35" },
    });
    fireEvent.change(screen.getByLabelText(/Number of hires/), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText(/Responsibilities/), {
      target: {
        value: "Own platform reliability\nImprove deployment workflows",
      },
    });
    fireEvent.change(screen.getByLabelText(/Requirements/), {
      target: { value: "Strong TypeScript\nCloud infrastructure experience" },
    });
    fireEvent.change(screen.getByLabelText(/Working hours/), {
      target: { value: "Monday-Friday, 9:00-18:00" },
    });
    fireEvent.change(screen.getByLabelText(/Work address/), {
      target: { value: "District 1, Ho Chi Minh City" },
    });
    fireEvent.click(screen.getByLabelText("Holiday and Tet bonus"));
    fireEvent.click(screen.getByLabelText(/Urgent hiring/));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as {
      job: (typeof initialData.jobs)[0];
    };
    expect(payload.job.salary).toMatchObject({
      min: 29_000_000,
      max: 33_000_000,
      isNegotiable: true,
    });
    expect(payload.job.age).toBe("24-35");
    expect(payload.job.numberOfHires).toBe(3);
    expect(payload.job.isUrgent).toBe(true);
    expect(payload.job.description.responsibilities).toEqual([
      "Own platform reliability",
      "Improve deployment workflows",
    ]);
    expect(payload.job.description.requirements).toEqual([
      "Strong TypeScript",
      "Cloud infrastructure experience",
    ]);
    expect(payload.job.description.benefits).toContainEqual({
      icon: "gift",
      label: "Holiday and Tet bonus",
    });
    expect(payload.job.description.generalInfo).toMatchObject({
      workingHours: "Monday-Friday, 9:00-18:00",
      workAddress: "District 1, Ho Chi Minh City",
    });
  });
  it("supports typing the 29tr salary shorthand one character at a time", () => {
    render(<RecruiterJobPostingManagement initialData={initialData} />);
    fireEvent.click(screen.getByRole("button", { name: "Create job posting" }));

    const minimum = screen.getByLabelText(/Minimum salary/);
    fireEvent.change(minimum, { target: { value: "2" } });
    fireEvent.change(minimum, { target: { value: "29" } });
    fireEvent.change(minimum, { target: { value: "29t" } });
    expect(minimum).toHaveValue("29t");
    fireEvent.change(minimum, { target: { value: "29tr" } });

    expect(minimum).toHaveValue("29.000.000");
    expect(screen.getByText("From 29,000,000 VND/month")).toBeVisible();
  });
  it("exposes every jobs.json field and updates the structured candidate preview", () => {
    render(<RecruiterJobPostingManagement initialData={initialData} />);
    fireEvent.click(screen.getByRole("button", { name: "Create job posting" }));

    expect(screen.getByLabelText(/Minimum years/)).toBeVisible();
    expect(screen.getByLabelText(/Job level/)).toBeVisible();
    expect(screen.getByLabelText(/Education/)).toBeVisible();
    expect(screen.getByLabelText(/Age range/)).toBeVisible();
    expect(screen.getByLabelText(/Number of hires/)).toBeVisible();
    expect(screen.getByLabelText(/Work on Saturday/)).toBeVisible();
    expect(screen.getByLabelText(/Nationwide remote/)).toBeVisible();
    expect(screen.getByLabelText(/Urgent hiring/)).toBeVisible();
    expect(screen.getByLabelText(/Top reason 1/)).toBeVisible();
    expect(screen.getByLabelText(/Responsibilities/)).toBeVisible();
    expect(screen.getByLabelText(/Requirements/)).toBeVisible();
    expect(screen.getByLabelText(/Reports to/)).toBeVisible();
    expect(screen.getByLabelText(/Working hours/)).toBeVisible();
    expect(screen.getByLabelText(/Work address/)).toBeVisible();

    fireEvent.change(screen.getByLabelText(/Minimum years/), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText(/Experience label/), {
      target: { value: "3+ years" },
    });
    fireEvent.change(screen.getByLabelText(/Reports to/), {
      target: { value: "Head of Engineering" },
    });
    fireEvent.change(screen.getByLabelText(/Top reason 1/), {
      target: { value: "Own meaningful product decisions" },
    });

    const preview = screen.getByText("Live candidate preview").closest("aside");
    expect(preview).not.toBeNull();
    expect(within(preview!).getByText("3+ years")).toBeVisible();
    expect(screen.getByLabelText(/Reports to/)).toHaveValue(
      "Head of Engineering",
    );
    expect(screen.getByLabelText(/Top reason 1/)).toHaveValue(
      "Own meaningful product decisions",
    );

    fireEvent.change(screen.getByLabelText(/Age range/), {
      target: { value: "23-30" },
    });
    fireEvent.change(screen.getByLabelText(/Number of hires/), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByLabelText(/Nationwide remote/));
    fireEvent.click(screen.getByLabelText(/Work on Saturday/));
    fireEvent.click(screen.getByLabelText(/Urgent hiring/));
    fireEvent.click(screen.getByLabelText("Holiday and Tet bonus"));

    expect(screen.getByLabelText(/Age range/)).toHaveValue("23-30");
    expect(screen.getByLabelText(/Number of hires/)).toHaveValue(4);
    expect(screen.getByLabelText(/Nationwide remote/)).toBeChecked();
    expect(screen.getByLabelText(/Work on Saturday/)).toBeChecked();
    expect(screen.getByLabelText(/Urgent hiring/)).toBeChecked();
    expect(screen.getByLabelText("Holiday and Tet bonus")).toBeChecked();
    expect(within(preview!).getByText("4 positions")).toBeVisible();
  });

  it("keeps benefit selection cards and boolean toggles local to the form", () => {
    render(<RecruiterJobPostingManagement initialData={initialData} />);
    fireEvent.click(screen.getByRole("button", { name: "Create job posting" }));

    const urgent = screen.getByLabelText(/Urgent hiring/);
    const saturday = screen.getByLabelText(/Work on Saturday/);
    const nationwide = screen.getByLabelText(/Nationwide remote/);
    const locationSection = screen
      .getByText("Location & work arrangement")
      .closest("details");
    const hiringSection = screen
      .getByText("Hiring settings")
      .closest("details");

    fireEvent.click(nationwide);
    fireEvent.click(saturday);
    fireEvent.click(urgent);

    expect(nationwide).toBeChecked();
    expect(saturday).toBeChecked();
    expect(urgent).toBeChecked();
    expect(locationSection).toHaveAttribute("open");
    expect(hiringSection).toHaveAttribute("open");

    fireEvent.click(nationwide);
    fireEvent.click(saturday);
    fireEvent.click(urgent);

    expect(nationwide).not.toBeChecked();
    expect(saturday).not.toBeChecked();
    expect(urgent).not.toBeChecked();

    const benefit = screen.getByRole("checkbox", {
      name: "Holiday and Tet bonus",
    });
    fireEvent.click(benefit);
    const benefitCard = document.querySelector(
      ".recruiter-benefit-option.is-selected",
    );
    expect(benefitCard).not.toBeNull();
    expect(benefitCard).toHaveClass("is-selected");
    expect(benefitCard?.querySelector(".recruiter-benefit-icon")).toBeTruthy();
    expect(
      within(benefitCard as HTMLElement).getByLabelText(
        "Benefit label for Holiday and Tet bonus",
      ),
    ).toBeEnabled();
    expect(
      benefitCard?.querySelector(".recruiter-benefit-card__check"),
    ).toBeTruthy();
  });
});
