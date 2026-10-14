-- Telão: um único dia ativo por vez. O /cronometro exibe automaticamente o dia ativado pelo professor primário.
alter table event_days add column display_active_at timestamptz;
alter table event_days add column display_activated_by int references users(id);
create unique index event_days_one_display on event_days ((true)) where display_active_at is not null;
