import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { render } from "vitest-browser-react";

import { HomeRedirect } from "./HomeRedirect";

const Where = () => {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
};

describe("HomeRedirect (react-admin's home route)", () => {
  it("sends / to /dashboard, keeping the query (?workspace=calendar)", async () => {
    const screen = await render(
      <MemoryRouter initialEntries={["/?workspace=calendar"]}>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/dashboard" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    await expect
      .element(screen.getByTestId("where"))
      .toHaveTextContent("/dashboard?workspace=calendar");
  });
});
