-- =============================================================================
-- seed.sql - demo departments, courses and official fee types.
-- Safe to run more than once (existing rows are left untouched).
-- Users are NOT created here: run scripts/create_admin.py for the first admin.
-- =============================================================================

insert into public.departments (name, code) values
  ('Computer Science',        'CSC'),
  ('Business Administration', 'BBA'),
  ('Nursing',                 'NUR')
on conflict (code) do nothing;

insert into public.courses (code, title, department_id, credits, semester)
select v.code, v.title, d.id, v.credits, v.semester
from (values
  ('CSC201', 'Data Structures and Algorithms', 'CSC', 3, 1),
  ('CSC301', 'Database Systems',               'CSC', 3, 1),
  ('CSC401', 'Software Engineering',           'CSC', 3, 1),
  ('BBA201', 'Principles of Management',       'BBA', 3, 1),
  ('BBA301', 'Financial Accounting',           'BBA', 3, 1),
  ('NUR101', 'Anatomy and Physiology',         'NUR', 4, 1),
  ('NUR201', 'Fundamentals of Nursing',        'NUR', 4, 1)
) as v (code, title, dept_code, credits, semester)
join public.departments d on d.code = v.dept_code
on conflict (code) do nothing;

insert into public.fee_types (name, category, amount, currency, description) values
  ('Tuition Fee - Semester 1',   'tuition',           4500.00, 'USD', 'Tuition for the first semester'),
  ('Medical Insurance - Annual', 'medical_insurance',  300.00, 'USD', 'Student medical insurance for one academic year'),
  ('Registration Fee',           'registration',       100.00, 'USD', 'Registration for the academic year'),
  ('Library/ICT Fee',            'other',              150.00, 'USD', 'Library and ICT services for the academic year')
on conflict (name) do nothing;
