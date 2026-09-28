/** Role-specific wrappers so each pages.json key maps to a prop-less component. */
import { RegisterUserPage } from './RegisterUserPage';
import { UserListPage } from './UserListPage';

export const StudentsPage = () => <UserListPage role="student" />;
export const TeachersPage = () => <UserListPage role="teacher" />;
export const AdminsPage = () => <UserListPage role="admin" />;
export const RegisterStudentPage = () => <RegisterUserPage role="student" />;
export const RegisterTeacherPage = () => <RegisterUserPage role="teacher" />;
export const RegisterAdminPage = () => <RegisterUserPage role="admin" />;
export { default as UserDetailPage } from './UserDetailPage';
export { default as FaceEnrollmentPage } from './FaceEnrollmentPage';
