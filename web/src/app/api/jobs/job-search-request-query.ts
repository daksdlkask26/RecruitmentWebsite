export function jobSearchRequestQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const value = (name: string) => params.get(name) ?? undefined;

  return {
    q: value("q"),
    searchMode: value("searchMode"),
    searchBy: value("searchBy"),
    location: value("location"),
    district: params.getAll("district"),
    categoryFamily: params.getAll("categoryFamily"),
    categoryId: params.getAll("categoryId"),
    categoryTitle: params.getAll("categoryTitle"),
    employmentType: params.getAll("employmentType"),
    experienceLevel: params.getAll("experienceLevel"),
    workArrangement: params.getAll("workArrangement"),
    careerPath: value("careerPath"),
    skills: params.getAll("skills"),
    salaryMin: value("salaryMin"),
    salaryMax: value("salaryMax"),
    salaryNegotiable: value("salaryNegotiable"),
    salaryCurrency: value("salaryCurrency"),
    salaryPeriod: value("salaryPeriod"),
    postedWithinDays: value("postedWithinDays"),
    sort: value("sort"),
    cursor: value("cursor"),
    page: value("page"),
    limit: value("limit"),
  };
}
