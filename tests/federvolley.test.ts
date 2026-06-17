import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFedervolleySourceTitle,
  extractFedervolleyNodeId,
  extractMatchshareLid,
  fetchFedervolleyTournament,
  filterFedervolleyUpcomingTournaments,
  isActiveFedervolleyMatch,
  parseFedervolleyListing,
  parseFedervolleyMatchshareBracket,
  parseFedervolleyTournamentPage,
  parseFedervolleyTournamentPageMatches,
} from "../backend/src/sources/tbvolley/Federvolley";

test("Federvolley listing parser extracts Assoluto rows", () => {
  const html = `
    <div class="torneitable-summary-row-1 container-fluid">
      <div class="row">
        <div class="col-3 d-none d-sm-block col-sm-2 col-lg-1 px-2 px-sm-3">
          <h5><span class="badge badge-pill badge-dark torneo-code">18013</span></h5>
        </div>
        <div class="col-9 col-md-10">
          <div class="container-fluid p-0 border-0">
            <div class="row border-0 my-3 my-md-0">
              <div class="col-6 col-sm-4 col-md-5 col-lg-4 px-1 text-align-center">Campionato Italiano Assoluto - Finale</div>
              <div class="col-6 col-sm-4 col-md-4 col-lg-2 d-none d-sm-block text-align-center">Caorle<br>VENETO</div>
              <div class="col-6 col-sm-4 col-md-3 col-lg-2 py-2 px-1 px-sm-3">
                <div class="float-left text-align-center">SET<br><span class="badge bg-color-primary torneo-day">04</span><br>2026</div>
                <div class="float-right text-align-center">SET<br><span class="badge bg-color-primary torneo-day">06</span><br>2026</div>
              </div>
              <div class="col-6 col-md-2 d-none d-lg-block text-align-center">maschile</div>
              <div class="col-6 col-md-2 d-none d-lg-block text-align-center">€0.00</div>
            </div>
          </div>
        </div>
        <div class="col-12 col-sm-1 d-none d-lg-block text-align-center">
          <a href="/index.php/node/66744"><i class="far fa-arrow-alt-circle-right fa-lg"></i></a>
        </div>
      </div>
    </div>
  `;

  const tournaments = parseFedervolleyListing(html, {
    category: "assoluto",
    gender: "men",
    year: 2026,
  });

  assert.equal(tournaments.length, 1);
  assert.equal(tournaments[0].nodeId, "66744");
  assert.equal(tournaments[0].title, "Campionato Italiano Assoluto - Finale");
  assert.equal(tournaments[0].location, "Caorle, VENETO");
  assert.equal(tournaments[0].startDate, "2026-09-04");
  assert.equal(tournaments[0].endDate, "2026-09-06");
});

test("Federvolley tournament page parser extracts lid and metadata", () => {
  const html = `
    <div class="field field--name-title">Campionato Italiano Assoluto - Finale - Caorle</div>
    <div class="field field--name-field-sesso-torneo">Maschile</div>
    <div class="field field--name-field-montepremi">€ 0,00</div>
    <div class="field field--name-field-tipo-tabellone">Tipologia Main Draw: Doppia eliminazione</div>
    <div class="field field--name-field-numero-squadre">16 squadre al Main Draw</div>
    <div class="field field--name-field-data-inizio"><time datetime="2026-09-04T00:00:00+02:00">04 Settembre 2026</time></div>
    <div class="field field--name-field-data-fine"><time datetime="2026-09-06T00:00:00+02:00">06 Settembre 2026</time></div>
    <a href="https://srv.matchshare.it/bvl_test/bracket.php?lid=11518&client_name=bvl_development">Vai al tabellone</a>
  `;

  const tournament = parseFedervolleyTournamentPage(html, {
    nodeId: "66744",
    pageUrl: "https://beachvolley.federvolley.it/index.php/node/66744",
  });

  assert.equal(tournament.title, "Campionato Italiano Assoluto - Finale - Caorle");
  assert.equal(tournament.gender, "men");
  assert.equal(tournament.matchshareLid, "11518");
  assert.equal(tournament.startDate, "2026-09-04");
  assert.equal(tournament.bracketType, "Tipologia Main Draw: Doppia eliminazione");
  assert.equal(tournament.teams, 16);
});

test("Federvolley Matchshare parser extracts matches and set scores", () => {
  const payload = [[
    {
      tipo: "Maindraw",
      teams: [
        { name: "(1) CAIMI C. - MAIOCCHI C.", id: 12597, score: 2 },
        { name: "BYE 2", id: 14131, score: 0 },
        { name: "(9) MAURO E. - CASTAGNANOVA SABRINA C.", id: 21562, score: 2 },
        { name: "(8) GIBELLINI M. - CESTARI D.", id: 21580, score: 0 },
      ],
      numero: [1, 2],
      info: [
        "<p hidden>data: 10-30 09:30\ncampo: 4\nfase: 1v\nrisultato: 2-0\nparziali: 15-7 , 15-11</p>",
        "<p hidden>data: 10-30 10:00\ncampo: 5\nfase: 1v\nrisultato: 0-2\nparziali: 13-15 , 12-15</p>",
      ],
    },
  ]];

  const matches = parseFedervolleyMatchshareBracket(payload, {
    nodeId: "67363",
    matchshareLid: "11680",
    gender: "women",
    category: "serie",
    pageUrl: "https://beachvolley.federvolley.it/index.php/node/67363",
    startDate: "2026-10-30",
    endDate: "2026-10-31",
  });

  assert.equal(matches.length, 2);
  assert.equal(matches[0].id, "11680-1");
  assert.equal(matches[0].teamA.name, "CAIMI C. / MAIOCCHI C.");
  assert.equal(matches[0].teamB.name, "TBD");
  assert.equal(matches[0].round, "1v");
  assert.equal(matches[0].court, "Court 4");
  assert.equal(matches[0].startTimeMoscow, "30.10.2026 11:30:00");
  assert.deepEqual(matches[0].score.sets, [
    { no: 1, teamA: 15, teamB: 7 },
    { no: 2, teamA: 15, teamB: 11 },
  ]);
});

test("Federvolley tournament page parser extracts result cards as upcoming schedule", () => {
  const html = `
    <div class="tabella-risultati-tappa">
      <div class="tabella-desktop">
        <div class="risultato-wrapper" data-hteam="45419" data-vteam="751" data-day="1" data-season="43237">
          <div class="intestazione-tabella-nera text-center intestazione-qualificazione">
            <span class="border-bottom-yellow">12-06-2026 09:00</span>
            &nbsp;-&nbsp;<span class="border-bottom-yellow">Campo: 2 - Gara n.1</span>
            <br/>
            <span>Qualificazioni Campionato Italiano Assoluto - Tappa - Falconara Marittima 12 June m 2026, PERCORSO PRIMA COPPIA QUALIFICATA</span>
          </div>
          <div class="row">
            <div class="elemento-riga-risultato col-12 col-md-5 text-center text-md-right vincitore">
              ---
              <br><span class="badge badge-warning"><a href="/index.php/node/15308">MUSSA FABRIZIO</a> - <a href="/index.php/node/15938">LUISETTO MICHELE</a></span>
            </div>
            <div class="elemento-riga-risultato punteggio-match col-12 col-md-2 text-center">0 -0
              <div class="row"></div>
            </div>
            <div class="elemento-riga-risultato col-12 col-md-5 text-center text-md-left sconfitto">
              ---
              <br><span class="badge badge-warning"><a href="/index.php/node/36361">DELLA LUNGA DORE</a> - <a href="/index.php/node/15997">GIULIANI ANDREA</a></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const matches = parseFedervolleyTournamentPageMatches(html, {
    nodeId: "66727",
    matchshareLid: "11518",
    gender: "men",
    category: "assoluto",
    pageUrl: "https://beachvolley.federvolley.it/index.php/node/66727",
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "11518-html-1");
  assert.equal(matches[0].teamA.name, "MUSSA FABRIZIO / LUISETTO MICHELE");
  assert.equal(matches[0].teamB.name, "DELLA LUNGA DORE / GIULIANI ANDREA");
  assert.equal(matches[0].teamA.id, "45419");
  assert.equal(matches[0].teamB.id, "751");
  assert.equal(matches[0].court, "Court 2");
  assert.equal(matches[0].stage, "Qualification");
  assert.equal(matches[0].round, "PERCORSO PRIMA COPPIA QUALIFICATA");
  assert.equal(matches[0].status, "upcoming");
  assert.equal(matches[0].startTimeMoscow, "12.06.2026 10:00:00");
  assert.equal(matches[0].score.teamA, null);
  assert.equal(matches[0].score.teamB, null);
});

test("Federvolley tournament fetch treats Matchshare HTTP errors as unavailable bracket", async () => {
  const originalFetch = globalThis.fetch;
  const html = `
    <div class="field field--name-title">Campionato Italiano Assoluto - Tappa - Falconara</div>
    <div class="field field--name-field-sesso-torneo">Maschile</div>
    <div class="field field--name-field-data-inizio"><time datetime="2026-06-12T00:00:00+02:00">12 Giugno 2026</time></div>
    <div class="field field--name-field-data-fine"><time datetime="2026-06-14T00:00:00+02:00">14 Giugno 2026</time></div>
    <a href="https://srv.matchshare.it/bvl_test/bracket.php?lid=11518&client_name=bvl_development">Vai al tabellone</a>
  `;

  try {
    for (const status of [403, 429, 500]) {
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("json_for_bracket")) {
          return new Response("<html><title>Matchshare unavailable</title></html>", { status });
        }
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      };

      const tournament = await fetchFedervolleyTournament({
        federvolleyNodeId: "66727",
        category: "assoluto",
        gender: "men",
      });

      assert.equal(tournament.matchshareLid, "11518");
      assert.equal(tournament.matches?.length, 0);
      assert.equal(tournament.matchCount, 0);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Federvolley tournament fetch falls back to page result cards when Matchshare is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const html = `
    <div class="field field--name-title">Campionato Italiano Assoluto - Tappa - Falconara</div>
    <div class="field field--name-field-sesso-torneo">Maschile</div>
    <div class="field field--name-field-data-inizio"><time datetime="2026-06-12T00:00:00+02:00">12 Giugno 2026</time></div>
    <div class="field field--name-field-data-fine"><time datetime="2026-06-14T00:00:00+02:00">14 Giugno 2026</time></div>
    <a href="https://srv.matchshare.it/bvl_test/bracket.php?lid=11518&client_name=bvl_development">Vai al tabellone</a>
    <div class="tabella-risultati-tappa">
      <div class="risultato-wrapper" data-hteam="45419" data-vteam="751">
        <div class="intestazione-tabella-nera text-center intestazione-qualificazione">
          <span class="border-bottom-yellow">12-06-2026 09:00</span>
          <span class="border-bottom-yellow">Campo: 2 - Gara n.1</span>
          <span>Qualificazioni Campionato Italiano Assoluto - Tappa - Falconara Marittima 12 June m 2026, PERCORSO PRIMA COPPIA QUALIFICATA</span>
        </div>
        <div class="elemento-riga-risultato"><span class="badge badge-warning">MUSSA FABRIZIO - LUISETTO MICHELE</span></div>
        <div class="punteggio-match">0 -0</div>
        <div class="elemento-riga-risultato"><span class="badge badge-warning">DELLA LUNGA DORE - GIULIANI ANDREA</span></div>
      </div>
    </div>
  `;

  try {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("json_for_bracket")) {
        return new Response("<html><title>Matchshare unavailable</title></html>", { status: 500 });
      }
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    };

    const tournament = await fetchFedervolleyTournament({
      federvolleyNodeId: "66727",
      category: "assoluto",
      gender: "men",
    });

    assert.equal(tournament.matchshareLid, "11518");
    assert.equal(tournament.matches?.length, 1);
    assert.equal(tournament.matchCount, 1);
    assert.equal(tournament.matches?.[0].status, "upcoming");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Federvolley helpers resolve source ids", () => {
  assert.equal(extractFedervolleyNodeId("https://beachvolley.federvolley.it/index.php/node/66744"), "66744");
  assert.equal(extractMatchshareLid("Campionato Italiano [FIPAV:assoluto:66744:11518]"), "11518");
  assert.equal(buildFedervolleySourceTitle("Campionato Italiano Assoluto - Finale - Caorle", "men", "assoluto", "66744", "11518"), "Campionato Italiano Assoluto - Finale - Caorle — Men [FIPAV:assoluto:66744:11518]");
});

test("Federvolley filters drop completed tournaments and matches", () => {
  const html = `
    <div class="torneitable-summary-row-1 container-fluid">
      <div class="row">
        <div class="col-9 col-md-10">
          <div class="container-fluid p-0 border-0">
            <div class="row border-0 my-3 my-md-0">
              <div class="col-6 col-sm-4 col-md-5 col-lg-4 px-1 text-align-center">Campionato Italiano Assoluto - Old</div>
              <div class="col-6 col-sm-4 col-md-4 col-lg-2 d-none d-sm-block text-align-center">Roma<br>LAZIO</div>
              <div class="col-6 col-sm-4 col-md-3 col-lg-2 py-2 px-1 px-sm-3">
                <div class="float-left text-align-center">MAG<br><span class="badge bg-color-primary torneo-day">01</span><br>2026</div>
                <div class="float-right text-align-center">MAG<br><span class="badge bg-color-primary torneo-day">03</span><br>2026</div>
              </div>
              <div class="col-6 col-md-2 d-none d-lg-block text-align-center">maschile</div>
              <div class="col-6 col-md-2 d-none d-lg-block text-align-center">€0.00</div>
            </div>
          </div>
        </div>
        <div class="col-12 col-sm-1 d-none d-lg-block text-align-center">
          <a href="/index.php/node/66701">open</a>
        </div>
      </div>
    </div>
    <div class="torneitable-summary-row-2 container-fluid">
      <div class="row">
        <div class="col-9 col-md-10">
          <div class="container-fluid p-0 border-0">
            <div class="row border-0 my-3 my-md-0">
              <div class="col-6 col-sm-4 col-md-5 col-lg-4 px-1 text-align-center">Campionato Italiano Assoluto - Future</div>
              <div class="col-6 col-sm-4 col-md-4 col-lg-2 d-none d-sm-block text-align-center">Caorle<br>VENETO</div>
              <div class="col-6 col-sm-4 col-md-3 col-lg-2 py-2 px-1 px-sm-3">
                <div class="float-left text-align-center">SET<br><span class="badge bg-color-primary torneo-day">04</span><br>2026</div>
                <div class="float-right text-align-center">SET<br><span class="badge bg-color-primary torneo-day">06</span><br>2026</div>
              </div>
              <div class="col-6 col-md-2 d-none d-lg-block text-align-center">maschile</div>
              <div class="col-6 col-md-2 d-none d-lg-block text-align-center">€0.00</div>
            </div>
          </div>
        </div>
        <div class="col-12 col-sm-1 d-none d-lg-block text-align-center">
          <a href="/index.php/node/66744">open</a>
        </div>
      </div>
    </div>
  `;
  const tournaments = parseFedervolleyListing(html, {
    category: "assoluto",
    gender: "men",
    year: 2026,
  });

  assert.deepEqual(
    filterFedervolleyUpcomingTournaments(tournaments, new Date("2026-06-11T00:00:00.000Z")).map((tournament) => tournament.nodeId),
    ["66744"],
  );
  assert.equal(isActiveFedervolleyMatch({
    status: "finished",
    startTimeUtc: "2026-09-04T08:00:00.000Z",
  }, new Date("2026-06-11T00:00:00.000Z")), false);
  assert.equal(isActiveFedervolleyMatch({
    status: "upcoming",
    startTimeUtc: "2026-06-10T08:00:00.000Z",
  }, new Date("2026-06-11T00:00:00.000Z")), false);
  assert.equal(isActiveFedervolleyMatch({
    status: "upcoming",
    startTimeUtc: "2026-09-04T08:00:00.000Z",
  }, new Date("2026-06-11T00:00:00.000Z")), true);
});
