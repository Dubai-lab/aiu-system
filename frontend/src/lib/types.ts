export type Role = 'admin' | 'teacher' | 'student';

export interface DepartmentRef {
  id: string;
  name: string;
  code: string;
}

/** The logged-in user's profile, as returned by GET /me. */
export interface Me {
  id: string;
  role: Role;
  full_name: string;
  email: string;
  reg_number: string | null;
  staff_title: string | null;
  department: DepartmentRef | null;
  level: number | null;
  intake_year: number | null;
  phone: string | null;
  face_enrolled: boolean;
  must_change_password: boolean;
  is_active: boolean;
  created_at: string;
  force_password_change: boolean;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number | null;
  profile: Omit<Me, 'force_password_change'>;
}

export interface MessageResponse {
  message: string;
}

export interface ChangePasswordResponse {
  message: string;
  access_token: string;
  refresh_token: string;
}

export interface Department {
  id: string;
  name: string;
  code: string;
}

export interface UserListItem {
  id: string;
  role: Role;
  full_name: string;
  email: string;
  reg_number: string | null;
  staff_title: string | null;
  department_code: string | null;
  level: number | null;
  face_enrolled: boolean;
  must_change_password: boolean;
  is_active: boolean;
  created_at: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface CourseRef {
  id: string;
  code: string;
  title: string;
}

export interface UserDetail extends Omit<Me, 'force_password_change'> {
  courses: CourseRef[];
  credentials_email: {
    template: string;
    status: 'sent' | 'failed';
    error: string | null;
    created_at: string;
  } | null;
}

export interface DepartmentSummary extends Department {
  course_count: number;
  student_count: number;
  teacher_count: number;
}

export interface PersonRef {
  id: string;
  full_name: string;
  email: string;
  reg_number: string | null;
  staff_title: string | null;
  level: number | null;
  is_active: boolean;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  credits: number;
  semester: number;
  is_active: boolean;
  department: Department;
  teacher: PersonRef | null;
  enrolled_count: number;
}

export interface CourseDetail extends Course {
  students: PersonRef[] | null; // only for admins and the course's own teacher
}

export interface MyCourse {
  id: string;
  code: string;
  title: string;
  credits: number;
  semester: number;
  department: Department;
  teacher: PersonRef | null;
  enrolled_count: number | null;
  role: 'student' | 'teacher';
}

// ------------------------------------------------------------------ attendance
export interface CourseRefLite {
  id: string;
  code: string;
  title: string;
}

export interface SessionSummary {
  id: string;
  course: CourseRefLite;
  title: string;
  opens_at: string;
  closes_at: string;
  status: 'open' | 'closed';
  created_via: 'ui' | 'voice';
  seconds_left: number;
  present_count: number;
  enrolled_count: number;
}

export interface AttendanceRecord {
  student: PersonRef;
  marked_at: string;
  method: 'face' | 'manual';
  similarity: number | null;
  manual_reason: string | null;
}

export interface SessionDetail extends SessionSummary {
  code: string | null;
  present: AttendanceRecord[];
  absent: PersonRef[];
}

export interface StudentSession {
  id: string;
  course: CourseRefLite;
  title: string;
  closes_at: string;
  seconds_left: number;
  status: 'open' | 'closed';
  marked: boolean;
  marked_at: string | null;
}

export interface CourseAttendance {
  course: CourseRefLite;
  attended: number;
  total: number;
  percent: number | null;
  low: boolean;
  history: { session_id: string; title: string; opens_at: string; status: 'open' | 'closed'; present: boolean; method: 'face' | 'manual' | null }[];
}

export interface AttendanceReport {
  threshold: number;
  sessions_count: number;
  rows: { course: CourseRefLite; student: PersonRef; attended: number; total: number; percent: number | null; low: boolean }[];
}

// ------------------------------------------------------------------ finance
export type FeeCategory = 'tuition' | 'medical_insurance' | 'registration' | 'other';

export interface FeeType {
  id: string;
  name: string;
  category: FeeCategory;
  amount: number;
  currency: string;
  description: string | null;
  is_active: boolean;
}

export interface Payment {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  method: 'card' | 'mobile_money';
  status: 'success' | 'failed';
  failure_reason: string | null;
  is_simulated: boolean;
  paid_at: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  student: { id: string; full_name: string; email: string; reg_number: string | null };
  fee_type: { id: string; name: string; category: FeeCategory };
  description: string | null;
  amount: number;
  currency: string;
  status: 'unpaid' | 'paid' | 'cancelled';
  due_date: string;
  created_via: 'ui' | 'voice';
  created_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  overdue: boolean;
  receipt_payment_id: string | null;
}

export interface InvoiceDetail extends Invoice {
  payments: Payment[];
}

export interface InvoiceList extends Paginated<Invoice> {
  outstanding_total: number | null;
}

export interface CreateInvoiceResult {
  invoice: Invoice;
  created: boolean;
  official_amount: number;
  stated_amount: number | null;
  amount_differs: boolean;
  message: string;
}

export interface Receipt {
  university: string;
  payment: Payment;
  invoice_number: string;
  fee_name: string;
  student: { id: string; full_name: string; email: string; reg_number: string | null };
  department: string | null;
}
