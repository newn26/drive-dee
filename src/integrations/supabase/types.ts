export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          id: string
          target_email: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_email?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_email?: string | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      admin_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          permissions: string[]
          revoked_at: string | null
          revoked_by: string | null
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          permissions: string[]
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          permissions?: string[]
          revoked_at?: string | null
          revoked_by?: string | null
          token_hash?: string
        }
        Relationships: []
      }
      admin_members: {
        Row: {
          created_at: string
          email: string
          invited_by: string | null
          is_owner: boolean
          permissions: string[]
          status: string
          status_reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string
          invited_by?: string | null
          is_owner?: boolean
          permissions?: string[]
          status?: string
          status_reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          invited_by?: string | null
          is_owner?: boolean
          permissions?: string[]
          status?: string
          status_reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          booking_code: string
          car_id: string
          created_at: string
          days: number
          end_date: string
          hold_expires_at: string | null
          id: string
          notes: string | null
          pickup_location: string
          start_date: string
          status: Database["public"]["Enums"]["booking_status"]
          total_amount: number
          user_id: string
        }
        Insert: {
          booking_code?: string
          car_id: string
          created_at?: string
          days: number
          end_date: string
          hold_expires_at?: string | null
          id?: string
          notes?: string | null
          pickup_location?: string
          start_date: string
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount: number
          user_id: string
        }
        Update: {
          booking_code?: string
          car_id?: string
          created_at?: string
          days?: number
          end_date?: string
          hold_expires_at?: string | null
          id?: string
          notes?: string | null
          pickup_location?: string
          start_date?: string
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
        ]
      }
      cars: {
        Row: {
          brand: string
          category: string
          created_at: string
          description: string | null
          fuel: string
          id: string
          image_url: string | null
          mileage: number
          model: string
          plate_no: string
          price_per_day: number
          seats: number
          status: Database["public"]["Enums"]["car_status"]
          transmission: string
          year: number
        }
        Insert: {
          brand: string
          category?: string
          created_at?: string
          description?: string | null
          fuel?: string
          id?: string
          image_url?: string | null
          mileage?: number
          model: string
          plate_no: string
          price_per_day: number
          seats?: number
          status?: Database["public"]["Enums"]["car_status"]
          transmission?: string
          year: number
        }
        Update: {
          brand?: string
          category?: string
          created_at?: string
          description?: string | null
          fuel?: string
          id?: string
          image_url?: string | null
          mileage?: number
          model?: string
          plate_no?: string
          price_per_day?: number
          seats?: number
          status?: Database["public"]["Enums"]["car_status"]
          transmission?: string
          year?: number
        }
        Relationships: []
      }
      contract_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string
          booking_id: string
          contract_id: string | null
          created_at: string
          id: string
          note: string | null
          version: number | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role: string
          booking_id: string
          contract_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          version?: number | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string
          booking_id?: string
          contract_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_events_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_versions: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          additional_conditions: string
          approved_at: string | null
          approved_by: string | null
          car_label: string | null
          car_plate_no: string | null
          contract_id: string
          created_at: string
          created_by: string | null
          customer_license_no: string | null
          customer_name: string | null
          customer_phone: string | null
          deposit: number | null
          id: string
          is_legacy: boolean
          late_penalty: string | null
          mileage_allowance: string | null
          pickup_at: string | null
          pickup_location: string | null
          rental_days: number | null
          rental_price: number | null
          return_at: string | null
          sent_at: string | null
          superseded_at: string | null
          terms: string
          version: number
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          additional_conditions?: string
          approved_at?: string | null
          approved_by?: string | null
          car_label?: string | null
          car_plate_no?: string | null
          contract_id: string
          created_at?: string
          created_by?: string | null
          customer_license_no?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deposit?: number | null
          id?: string
          is_legacy?: boolean
          late_penalty?: string | null
          mileage_allowance?: string | null
          pickup_at?: string | null
          pickup_location?: string | null
          rental_days?: number | null
          rental_price?: number | null
          return_at?: string | null
          sent_at?: string | null
          superseded_at?: string | null
          terms: string
          version: number
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          additional_conditions?: string
          approved_at?: string | null
          approved_by?: string | null
          car_label?: string | null
          car_plate_no?: string | null
          contract_id?: string
          created_at?: string
          created_by?: string | null
          customer_license_no?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deposit?: number | null
          id?: string
          is_legacy?: boolean
          late_penalty?: string | null
          mileage_allowance?: string | null
          pickup_at?: string | null
          pickup_location?: string | null
          rental_days?: number | null
          rental_price?: number | null
          return_at?: string | null
          sent_at?: string | null
          superseded_at?: string | null
          terms?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "contract_versions_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          booking_id: string
          cancelled_at: string | null
          contract_no: string
          created_at: string
          current_version: number
          customer_accepted_at: string | null
          id: string
          paid_at: string | null
          revision_reason: string | null
          revision_requested_by: string | null
          sent_version: number | null
          status: string
          terms: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          booking_id: string
          cancelled_at?: string | null
          contract_no?: string
          created_at?: string
          current_version?: number
          customer_accepted_at?: string | null
          id?: string
          paid_at?: string | null
          revision_reason?: string | null
          revision_requested_by?: string | null
          sent_version?: number | null
          status?: string
          terms: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          booking_id?: string
          cancelled_at?: string | null
          contract_no?: string
          created_at?: string
          current_version?: number
          customer_accepted_at?: string | null
          id?: string
          paid_at?: string | null
          revision_reason?: string | null
          revision_requested_by?: string | null
          sent_version?: number | null
          status?: string
          terms?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance: {
        Row: {
          car_id: string
          completed_date: string | null
          cost: number
          created_at: string
          description: string | null
          id: string
          scheduled_date: string
          status: Database["public"]["Enums"]["maintenance_status"]
          title: string
        }
        Insert: {
          car_id: string
          completed_date?: string | null
          cost?: number
          created_at?: string
          description?: string | null
          id?: string
          scheduled_date: string
          status?: Database["public"]["Enums"]["maintenance_status"]
          title: string
        }
        Update: {
          car_id?: string
          completed_date?: string | null
          cost?: number
          created_at?: string
          description?: string | null
          id?: string
          scheduled_date?: string
          status?: Database["public"]["Enums"]["maintenance_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          booking_id: string
          card_last4: string | null
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          paid_at: string
          reference: string
          refund_status: string
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          booking_id: string
          card_last4?: string | null
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          paid_at?: string
          reference?: string
          refund_status?: string
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          booking_id?: string
          card_last4?: string | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          paid_at?: string
          reference?: string
          refund_status?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address: string | null
          created_at: string
          full_name: string
          id: string
          id_card_no: string | null
          license_no: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          full_name?: string
          id: string
          id_card_no?: string | null
          license_no?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          full_name?: string
          id?: string
          id_card_no?: string | null
          license_no?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          booking_id: string
          car_id: string
          comment: string | null
          created_at: string
          id: string
          rating: number
          reviewer_name: string
          user_id: string
        }
        Insert: {
          booking_id: string
          car_id: string
          comment?: string | null
          created_at?: string
          id?: string
          rating: number
          reviewer_name?: string
          user_id: string
        }
        Update: {
          booking_id?: string
          car_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          rating?: number
          reviewer_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_admin_invitation: { Args: { _token: string }; Returns: undefined }
      admin_approve_contract: {
        Args: { _contract_id: string; _version: number }
        Returns: undefined
      }
      admin_create_contract: {
        Args: {
          _additional_conditions?: string
          _booking_id: string
          _deposit: number
          _include_license?: boolean
          _late_penalty: string
          _mileage_allowance: string
          _pickup_at: string
          _return_at: string
        }
        Returns: string
      }
      admin_permission_list: { Args: never; Returns: string[] }
      admin_request_revision: {
        Args: { _contract_id: string; _reason: string; _version: number }
        Returns: undefined
      }
      admin_send_contract: {
        Args: { _contract_id: string }
        Returns: undefined
      }
      admin_update_contract: {
        Args: {
          _additional_conditions?: string
          _contract_id: string
          _deposit: number
          _include_license?: boolean
          _late_penalty: string
          _mileage_allowance: string
          _pickup_at: string
          _return_at: string
        }
        Returns: number
      }
      assert_booking_open: {
        Args: { _b: Database["public"]["Tables"]["bookings"]["Row"] }
        Returns: undefined
      }
      booked_car_ids: {
        Args: { _end: string; _start: string }
        Returns: string[]
      }
      booking_blocks_car: {
        Args: {
          _hold_expires_at: string
          _status: Database["public"]["Enums"]["booking_status"]
        }
        Returns: boolean
      }
      bootstrap_owner: { Args: { _email: string }; Returns: undefined }
      contract_hold_until: {
        Args: { _span: string; _start_date: string }
        Returns: string
      }
      customer_accept_contract: {
        Args: { _contract_id: string; _version: number }
        Returns: undefined
      }
      customer_request_revision: {
        Args: { _contract_id: string; _reason: string; _version: number }
        Returns: undefined
      }
      expire_stale_bookings: { Args: never; Returns: number }
      has_admin_permission: {
        Args: { _permission: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_owner: { Args: { _user_id: string }; Returns: boolean }
      log_admin_audit: {
        Args: {
          _action: string
          _details?: Json
          _target_email: string
          _target_user_id: string
        }
        Returns: undefined
      }
      log_contract_event: {
        Args: {
          _action: string
          _booking_id: string
          _contract_id: string
          _note: string
          _system?: boolean
          _version: number
        }
        Returns: undefined
      }
      owner_create_admin_invitation: {
        Args: { _email: string; _permissions: string[] }
        Returns: {
          invitation_id: string
          invite_expires_at: string
          invite_token: string
        }[]
      }
      owner_manual_confirm_booking: {
        Args: { _booking_id: string; _reason: string }
        Returns: undefined
      }
      owner_revoke_admin_invitation: {
        Args: { _invitation_id: string }
        Returns: undefined
      }
      owner_set_admin_permissions: {
        Args: { _permissions: string[]; _user_id: string }
        Returns: undefined
      }
      owner_set_admin_status: {
        Args: { _reason: string; _status: string; _user_id: string }
        Returns: undefined
      }
      pay_booking: {
        Args: {
          _booking_id: string
          _card_last4?: string
          _method: Database["public"]["Enums"]["payment_method"]
        }
        Returns: string
      }
      render_contract_terms: {
        Args: {
          _additional_conditions: string
          _car_label: string
          _car_plate_no: string
          _contract_no: string
          _customer_license_no: string
          _customer_name: string
          _customer_phone: string
          _deposit: number
          _late_penalty: string
          _mileage_allowance: string
          _pickup_at: string
          _pickup_location: string
          _rental_days: number
          _rental_price: number
          _return_at: string
          _version: number
        }
        Returns: string
      }
      require_admin_permission: {
        Args: { _permission: string }
        Returns: string
      }
      require_owner: { Args: never; Returns: string }
      validate_admin_permissions: {
        Args: { _permissions: string[] }
        Returns: string[]
      }
      write_contract_version: {
        Args: {
          _additional_conditions: string
          _b: Database["public"]["Tables"]["bookings"]["Row"]
          _contract: Database["public"]["Tables"]["contracts"]["Row"]
          _deposit: number
          _include_license: boolean
          _is_new: boolean
          _late_penalty: string
          _mileage_allowance: string
          _pickup_at: string
          _return_at: string
          _version: number
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "customer"
      booking_status:
        | "pending"
        | "confirmed"
        | "active"
        | "completed"
        | "cancelled"
      car_status: "available" | "rented" | "maintenance" | "unavailable"
      maintenance_status: "scheduled" | "in_progress" | "completed"
      payment_method: "qr" | "card"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "customer"],
      booking_status: [
        "pending",
        "confirmed",
        "active",
        "completed",
        "cancelled",
      ],
      car_status: ["available", "rented", "maintenance", "unavailable"],
      maintenance_status: ["scheduled", "in_progress", "completed"],
      payment_method: ["qr", "card"],
    },
  },
} as const
