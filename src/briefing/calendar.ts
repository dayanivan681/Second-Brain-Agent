/** Evento de calendario (solo lectura; el calendario es la autoridad). */
export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO 8601 o YYYY-MM-DD si es de día completo. */
  start: string;
  end?: string;
  allDay?: boolean;
}

export interface CalendarSource {
  readonly name: string;
  /** Eventos del día `date` (YYYY-MM-DD) en la zona horaria indicada. */
  eventsOn(date: string, timeZone: string): Promise<CalendarEvent[]>;
}

/** Calendario fijo para tests y desarrollo. */
export class StaticCalendar implements CalendarSource {
  readonly name = "static";
  constructor(private readonly events: CalendarEvent[]) {}

  async eventsOn(date: string, timeZone: string): Promise<CalendarEvent[]> {
    return this.events
      .filter((e) => (e.allDay ? e.start.slice(0, 10) : localDate(new Date(e.start), timeZone)) === date)
      .sort((a, b) => (a.start < b.start ? -1 : 1));
  }
}

/** Fecha local YYYY-MM-DD de un instante en una zona horaria. */
export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
