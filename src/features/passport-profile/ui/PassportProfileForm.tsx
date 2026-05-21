"use client";

import { useActionState } from "react";
import { updatePassportProfile } from "../server/actions";
import type { PassportActionState } from "../server/actions";
import type { SafePassportProfile } from "@/entities/user";

type Props = {
  initial: SafePassportProfile | null;
};

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  placeholder,
  required,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="block text-sm font-medium text-gray-700"
      >
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function toDateInput(d: Date | null | undefined): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export function PassportProfileForm({ initial }: Props) {
  const [state, dispatch, isPending] = useActionState<PassportActionState, FormData>(
    updatePassportProfile,
    null
  );

  return (
    <form action={dispatch} className="space-y-5">
      {/* 저장 결과 피드백 */}
      {state?.success === true && (
        <p className="rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          여권 정보가 저장되었습니다.
        </p>
      )}
      {state?.success === false && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </p>
      )}

      {/* 기존 데이터 마스킹 미리보기 */}
      {initial?.passportNo && state === null && (
        <p className="rounded-lg bg-gray-50 px-4 py-2.5 text-xs text-gray-500">
          현재 저장된 여권번호:{" "}
          <span className="font-mono font-medium text-gray-700">
            {initial.passportNo}
          </span>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="영문 성 (Last Name)"
          name="lastNameEn"
          defaultValue={initial?.lastNameEn}
          placeholder="HONG"
          required
          hint="여권에 표기된 영문 대문자"
        />
        <Field
          label="영문 이름 (First Name)"
          name="firstNameEn"
          defaultValue={initial?.firstNameEn}
          placeholder="GILDONG"
          required
          hint="여권에 표기된 영문 대문자"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="gender"
            className="block text-sm font-medium text-gray-700"
          >
            성별 <span className="text-red-500">*</span>
          </label>
          <select
            id="gender"
            name="gender"
            defaultValue={initial?.gender ?? ""}
            required
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="" disabled>
              선택
            </option>
            <option value="MALE">남성</option>
            <option value="FEMALE">여성</option>
          </select>
        </div>
        <Field
          label="국적 (Nationality)"
          name="nationality"
          defaultValue={initial?.nationality ?? "KR"}
          placeholder="KR"
          hint="ISO 3166-1 alpha-2 코드"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="생년월일"
          name="birthDate"
          type="date"
          defaultValue={toDateInput(initial?.birthDate)}
          required
        />
        <Field
          label="여권 만료일"
          name="expireDate"
          type="date"
          defaultValue={toDateInput(initial?.expireDate)}
          required
        />
      </div>

      <Field
        label="여권 번호"
        name="passportNo"
        placeholder="M12345678"
        required
        hint="영문 1~2자리 + 숫자 7~9자리"
      />

      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPending ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}
